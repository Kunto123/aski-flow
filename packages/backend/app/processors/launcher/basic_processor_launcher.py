from .abstract_topological_processor_launcher import AbstractTopologicalProcessorLauncher
from app.processors.runtime import get_output_cache


class BasicProcessorLauncher(AbstractTopologicalProcessorLauncher):
    """
    Basic Processor Launcher emiting event

    A class that launches processors based on configuration data.
    """

    def launch_processors(self, processors):
        session_id = None
        try:
            session_id = self.context.get_session_id() if self.context else None
        except Exception:
            session_id = None
        output_cache = get_output_cache()

        for processor in processors.values():
            self.notify_current_node_running(processor)
            try:
                output = processor.process_and_update()
                output_cache.set_output(session_id, processor.name, processor.get_output())
                self.notify_progress(processor, output)
            except Exception as e:
                self.notify_error(processor, e)
                raise e

    def launch_processors_for_node(self, processors, node_name=None):
        session_id = None
        try:
            session_id = self.context.get_session_id() if self.context else None
        except Exception:
            session_id = None
        output_cache = get_output_cache()

        for processor in processors.values():
            if processor.get_output() is None or processor.name == node_name:
                
                self.notify_current_node_running(processor)
                try:
                    output = processor.process_and_update()
                    output_cache.set_output(session_id, processor.name, processor.get_output())
                    self.notify_progress(processor, output)
                except Exception as e:
                    self.notify_error(processor, e)
                    raise e

            if processor.name == node_name:
                break
