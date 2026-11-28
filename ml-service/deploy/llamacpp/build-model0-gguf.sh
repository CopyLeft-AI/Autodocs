#!/usr/bin/env bash
# Turn the Model 0 adapter into a quantized GGUF file for llama.cpp.
# Usage: build-model0-gguf.sh ADAPTER_DIR LLAMA_CPP_DIR WORK_DIR [QUANTIZATION]
set -euo pipefail

if (( $# < 3 )); then
    sed -n '2,3p' "$0" >&2
    exit 2
fi
adapter=$1 llama=$2 work=$3 quantization=${4:-Q4_K_M}
here=$(cd "$(dirname "$0")" && pwd)
python=${PYTHON:-python3}
quantize=$llama/build/bin/llama-quantize

[[ -f $llama/convert_hf_to_gguf.py ]] || { echo "$llama is not a llama.cpp checkout" >&2; exit 1; }
[[ -x $quantize ]] || { echo "Build llama.cpp first: $quantize is missing" >&2; exit 1; }

mkdir -p "$work"
[[ -f $work/merged/config.json ]] || "$python" "$here/merge_adapter.py" "$adapter" "$work/merged"
[[ -f $work/model0.f16.gguf ]] || {
    "$python" "$llama/convert_hf_to_gguf.py" --outtype f16 "$work/merged" --outfile "$work/model0.f16.gguf.part"
    mv "$work/model0.f16.gguf.part" "$work/model0.f16.gguf"
}
"$quantize" "$work/model0.f16.gguf" "$work/model0.$quantization.gguf.part" "$quantization"
mv "$work/model0.$quantization.gguf.part" "$work/model0.$quantization.gguf"
echo "Ready: $work/model0.$quantization.gguf"
