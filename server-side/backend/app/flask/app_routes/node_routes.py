import json

from flask import Blueprint, request

from ...utils.node_extension_utils import get_dynamic_extension_config, get_extensions
from ...utils.local_model_files import list_local_model_files_payload

# from ...utils.openapi_reader import OpenAPIReader

node_blueprint = Blueprint("node_blueprint", __name__)


@node_blueprint.route("/node/extensions")
def get_node_extensions():
    extensions = get_extensions()
    return {"extensions": extensions}


@node_blueprint.route("/node/extensions/dynamic", methods=["POST"])
def get_dynamic_extension():
    request_body = request.json

    if request_body is None:
        raise Exception("Missing data")

    processor_type = request_body.get("processorType")
    data = request_body.get("data")

    config = get_dynamic_extension_config(processor_type, data)

    return config.dict()


@node_blueprint.route("/node/local-model-files", methods=["GET"])
def get_local_model_files():
    return list_local_model_files_payload()


# @node_blueprint.route("/node/openapi/<path:api_name>/models")
# def get_openapi_models(api_name):
#     api_reader = OpenAPIReader(f"./resources/openapi/{api_name}.json")
#     return api_reader.get_all_paths()


# @node_blueprint.route("/node/openapi/<path:api_name>/config/<path:id>")
# def get_openapi_model_config(api_name, id):
#     api_reader = OpenAPIReader(f"./resources/openapi/{api_name}.json")
#     return api_reader.get_request_schema(id)
