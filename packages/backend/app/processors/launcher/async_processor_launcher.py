import gc
import threading
import time
import eventlet
from eventlet.semaphore import Semaphore
import logging
import traceback

from typing import Dict, List
from enum import Enum

from .processor_event import ProcessorEvent

from .event_type import EventType

from ..observer.observer import Observer

from ..components.processor import Processor
from .abstract_topological_processor_launcher import (
    AbstractTopologicalProcessorLauncher,
)

from app.processors.runtime import get_output_cache


class AsyncProcessorLauncher(AbstractTopologicalProcessorLauncher, Observer):
    """
    AsyncProcessorLauncher extends the functionality of the Basic Processor Launcher.

    The main enhancement in this class is the implementation of the 'launch_processors' method,
    which leverages eventlet greenthreads. This allows for asynchronous execution of processors,
    enabling efficient handling of I/O-bound tasks and improving the overall performance of processor execution.
    """

    GREENTHREAD_POOL_SIZE = 7

    class NodeState(Enum):
        PENDING = 1
        RUNNING = 2
        COMPLETED = 3
        ERROR = 4

    class Node:
        def __init__(self, id: str, parent_ids: List[str], processor: Processor):
            self.id = id
            self.parent_ids = parent_ids
            self.state = AsyncProcessorLauncher.NodeState.PENDING
            self.output = None
            self.error = None
            self.processor = processor
            self.lock = Semaphore(1)

        def run(self):
            with self.lock:
                if self.state != AsyncProcessorLauncher.NodeState.PENDING:
                    logging.warning(
                        f"Node {self.id} is already being processed or completed."
                    )
                    return self.output

                self.state = AsyncProcessorLauncher.NodeState.RUNNING

                try:
                    self.output = self.processor.process_and_update()
                except Exception as e:
                    self.error = e
                    self.state = AsyncProcessorLauncher.NodeState.ERROR
                    # IMPORTANT:
                    # Never raise out of this node execution.
                    # Unhandled exceptions in eventlet greenthreads can abort
                    # the Socket.IO handler before it emits `run_end`, leaving
                    # the UI stuck in a loading state.
                    self.output = None
                    return self.output

                self.state = AsyncProcessorLauncher.NodeState.COMPLETED
                return self.output

        def get_processor(self):
            return self.processor

    def get_input_processor_names(self, processor: Processor):
        # Prefer config-declared inputs for robust dependency tracking.
        try:
            inputs = processor.get_inputs() or []
        except Exception:
            inputs = []
        parent_ids = [inp.get("inputNode") for inp in inputs if inp and inp.get("inputNode")]
        if parent_ids:
            return parent_ids
        return [input_processor.name for input_processor in processor.get_input_processors()]

    def convert_processors_to_node_dict(self, processors: List[Processor]):
        nodes = {}
        for processor in processors.values():
            nodes[processor.name] = self.Node(
                processor.name, self.get_input_processor_names(processor), processor
            )
        return nodes

    def launch_processors(self, processors: List[Processor]):
        for processor in processors.values():
            processor.add_observer(self)

        nodes = self.convert_processors_to_node_dict(processors)

        pool = eventlet.GreenPool(AsyncProcessorLauncher.GREENTHREAD_POOL_SIZE)

        logging.debug(nodes)

        initialized_nodes = set()

        stagnant_ticks = 0

        while nodes:
            error_detected = any(
                node.state == AsyncProcessorLauncher.NodeState.ERROR
                for node in nodes.values()
            )

            if error_detected:
                logging.debug("A node is in ERROR state. Halting processing.")
                break

            spawned_any = False

            for id, node in nodes.items():
                if (
                    node.state == AsyncProcessorLauncher.NodeState.PENDING
                    and self.can_run(node, nodes)
                    and id not in initialized_nodes
                ):
                    logging.debug(f"Spawning green thread for node {id}.")
                    initialized_nodes.add(id)
                    pool.spawn(self.run_node, node)
                    spawned_any = True

            eventlet.sleep(0.5)

            before = set(nodes.keys())
            nodes = self.remove_completed_nodes(nodes)
            after = set(nodes.keys())
            logging.debug(f"Remaining nodes: {[node.id for node in nodes.values()]}")

            # Deadlock/cycle detection: nothing spawned and nothing completed for a while.
            if (not spawned_any) and before == after:
                stagnant_ticks += 1
            else:
                stagnant_ticks = 0
            if stagnant_ticks >= 10:
                logging.error(
                    "Execution appears stuck (cycle or missing dependencies). Halting."
                )
                # Emit a visible error on remaining pending nodes.
                for n in nodes.values():
                    if n.state == AsyncProcessorLauncher.NodeState.PENDING:
                        self.notify_error(n.processor, RuntimeError("Graph deadlock/cycle detected"))
                        n.state = AsyncProcessorLauncher.NodeState.ERROR
                break

        # Best-effort wait: never let exceptions abort the socket handler.
        try:
            pool.waitall()
        except Exception as e:
            logging.error(f"GreenPool.waitall raised: {e}")
            pass

    def remove_completed_nodes(self, nodes: List[Node]):
        return {
            id: n
            for id, n in nodes.items()
            if n.state not in [AsyncProcessorLauncher.NodeState.COMPLETED]
        }

    def can_run(self, node: Node, nodes: List[Node]):
        # If parents aren't in the list, then the node can run
        return all(parent_id not in nodes for parent_id in node.parent_ids)

    def launch_processors_for_node(self, processors: List[Processor], node_name=None):
        for processor in processors.values():
            if processor.get_output() is None or processor.name == node_name:
                processor.add_observer(self)
                self.run_processor(processor)

            if processor.name == node_name:
                break

    def run_processor(self, processor: "Processor"):
        try:
            self.notify_current_node_running(processor)

            start_time = time.time()
            output = processor.process_and_update()

            # Persist last output so downstream nodes can be executed later
            # without requiring upstream re-run simultaneously.
            session_id = None
            try:
                session_id = self.context.get_session_id() if self.context else None
            except Exception:
                session_id = None
            get_output_cache().set_output(session_id, processor.name, processor.get_output())

            end_time = time.time()
            duration = end_time - start_time
            self.notify_progress(processor, output, duration=duration, isDone=True)
        except Exception as e:
            self.notify_error(processor, e)
            # IMPORTANT:
            # Do not re-raise here.
            #
            # This launcher is invoked from Socket.IO handlers. Re-raising will bubble
            # up and can prevent `run_end` from being emitted, leaving the UI stuck.
            return None

    def run_node(self, node: Node):
        try:
            processor = node.get_processor()
            self.notify_current_node_running(processor)

            start_time = time.time()
            output = node.run()

            session_id = None
            try:
                session_id = self.context.get_session_id() if self.context else None
            except Exception:
                session_id = None
            get_output_cache().set_output(session_id, processor.name, processor.get_output())

            if node.state == AsyncProcessorLauncher.NodeState.ERROR and node.error is not None:
                self.notify_error(processor, node.error)
            end_time = time.time()
            duration = end_time - start_time
            # Mark completion so the UI can reliably stop spinners and allow re-runs.
            # (Streaming processors can still emit intermediate updates via STREAMING.)
            self.notify_progress(node.get_processor(), output, duration=duration, isDone=True)
        except Exception as e:
            node.state = AsyncProcessorLauncher.NodeState.ERROR
            self.notify_error(node.get_processor(), e)
            traceback.print_exc()
            # IMPORTANT:
            # Do not re-raise here.
            #
            # If we re-raise, GreenPool.waitall() can raise and abort the socket
            # handler before it emits `run_end`, which causes the frontend to keep
            # spinning ("loading" forever).
            return None

    def notify(self, event: EventType, data: ProcessorEvent):
        if event == EventType.STREAMING:
            self.notify_streaming(data.source, data.output)
