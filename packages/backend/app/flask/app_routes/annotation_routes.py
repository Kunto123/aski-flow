from flask import Blueprint

annotation_blueprint = Blueprint("annotation_blueprint", __name__)

# Placeholder endpoints for Week 9 (Annotation UI/API).
# Full annotation UI is implemented in the UI layer; backend will store YOLO labels on disk.
@annotation_blueprint.route("/annotate/health", methods=["GET"])
def annotate_health():
    return {"status": "ok"}
