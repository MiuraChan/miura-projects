from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path


LLAMA_SERVER_EXPORT = "?llama_server@@YAHHPEAPEAD@Z"


def resolve_llama_root() -> Path:
    configured_root = os.environ.get("MEI_LLAMA_ROOT", "").strip()
    if configured_root:
        return Path(configured_root).expanduser().resolve()
    return Path(sys.executable).resolve().parent.parent


def main() -> int:
    llama_root = resolve_llama_root()
    ggml_path = llama_root / "ggml.dll"
    implementation = llama_root / "llama-server-impl.dll"
    if not ggml_path.is_file():
        raise FileNotFoundError(f"GGML runtime not found: {ggml_path}")
    if not implementation.is_file():
        raise FileNotFoundError(f"llama.cpp implementation not found: {implementation}")

    encoded_arguments = [argument.encode("utf-8") for argument in sys.argv]
    argument_vector_type = ctypes.c_char_p * (len(encoded_arguments) + 1)
    argument_vector = argument_vector_type(*encoded_arguments, None)

    with os.add_dll_directory(str(llama_root)):
        ggml_library = ctypes.CDLL(str(ggml_path))
        load_backends = ggml_library.ggml_backend_load_all_from_path
        load_backends.argtypes = [ctypes.c_char_p]
        load_backends.restype = None
        load_backends(str(llama_root).encode("utf-8"))

        llama_library = ctypes.CDLL(str(implementation))
        llama_server = getattr(llama_library, LLAMA_SERVER_EXPORT)
        llama_server.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_char_p)]
        llama_server.restype = ctypes.c_int
        return int(llama_server(len(encoded_arguments), argument_vector))


if __name__ == "__main__":
    raise SystemExit(main())
