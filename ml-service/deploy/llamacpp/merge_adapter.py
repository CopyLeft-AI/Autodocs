"""Merge the fine-tuned Model 0 LoRA adapter into its base model.

Usage: python merge_adapter.py ADAPTER_DIR OUTPUT_DIR [--base unsloth/phi-4]
"""
import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("adapter", type=Path, help="folder with adapter_config.json and the adapter weights")
    parser.add_argument("output", type=Path, help="new folder for the merged model")
    parser.add_argument(
        "--base", default="unsloth/phi-4",
        help="full-precision base model; the adapter was trained on the 4-bit form of unsloth/phi-4",
    )
    arguments = parser.parse_args()
    if not (arguments.adapter / "adapter_config.json").is_file():
        parser.error(f"{arguments.adapter} has no adapter_config.json")
    if arguments.output.exists() and any(arguments.output.iterdir()):
        parser.error(f"{arguments.output} is not empty")

    # Imported late so --help works without the heavy packages.
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base = AutoModelForCausalLM.from_pretrained(arguments.base, torch_dtype="auto", low_cpu_mem_usage=True)
    merged = PeftModel.from_pretrained(base, str(arguments.adapter)).merge_and_unload()
    merged.save_pretrained(arguments.output, safe_serialization=True)
    AutoTokenizer.from_pretrained(str(arguments.adapter)).save_pretrained(arguments.output)
    print(f"Merged model written to {arguments.output}")


if __name__ == "__main__":
    main()
