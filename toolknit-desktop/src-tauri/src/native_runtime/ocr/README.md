PP-OCRv5 mobile, derived ONNX opset 17, Apache-2.0.

Original PaddlePaddle model revisions and exact runtime hashes are in models.json.
The original model cards, parameters, configuration and Apache license are
distributed alongside the ONNX runtime at the public 7caiyun source directory.
ToolKnit exports the weights without retraining or quantization. The dictionary
adds the CTC blank and trailing space classes expected by the recognizer.
Engineering export/preparation: scripts/prepare-ocr-runtime.py. Python and Paddle
are not required or distributed in the desktop application.
