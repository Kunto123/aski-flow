from flask import Flask, jsonify, request

app = Flask(__name__)


@app.post("/llm")
def llm():
    payload = request.get_json(silent=True) or {}
    prompt = payload.get("prompt", "")
    return jsonify({"output": f"[local-llm placeholder] {prompt}"})


@app.post("/vision")
def vision():
    return jsonify({"error": "Not implemented"}), 501


@app.post("/image")
def image():
    return jsonify({"error": "Not implemented"}), 501


@app.post("/embedding")
def embedding():
    return jsonify({"error": "Not implemented"}), 501


@app.post("/asr")
def asr():
    return jsonify({"error": "Not implemented"}), 501


@app.post("/tts")
def tts():
    return jsonify({"error": "Not implemented"}), 501


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001)
