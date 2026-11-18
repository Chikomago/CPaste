"""Report missing DLL imports before running Rust tests on Windows."""
import ctypes
import json
import os
from pathlib import Path
import struct
import subprocess
import sys


def imports(path):
    data = Path(path).read_bytes()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    sections, optional_size = struct.unpack_from('<H', data, pe + 6)[0], struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    is64 = struct.unpack_from('<H', data, optional)[0] == 0x20b
    directory = optional + (112 if is64 else 96)
    import_rva = struct.unpack_from('<I', data, directory + 8)[0]
    headers = []
    for index in range(sections):
        pos = optional + optional_size + index * 40
        virtual_size, address, raw_size, raw = struct.unpack_from('<IIII', data, pos + 8)
        headers.append((address, max(virtual_size, raw_size), raw))

    def offset(rva):
        for address, size, raw in headers:
            if address <= rva < address + size:
                return raw + rva - address
        return rva

    def string(rva):
        start = offset(rva)
        return data[start:data.index(b'\0', start)]

    if not import_rva:
        return
    pos = offset(import_rva)
    while True:
        original, _, _, name, thunk = struct.unpack_from('<IIIII', data, pos)
        if not name:
            break
        width, code = (8, '<Q') if is64 else (4, '<I')
        table = offset(original or thunk)
        symbols = []
        while True:
            value = struct.unpack_from(code, data, table)[0]
            if not value:
                break
            symbols.append(value & 0xffff if value & (1 << (width * 8 - 1)) else string(value + 2).decode('ascii'))
            table += width
        yield string(name).decode('ascii'), symbols
        pos += 20


def diagnose(executable):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryW.argtypes = [ctypes.c_wchar_p]
    kernel.LoadLibraryW.restype = ctypes.c_void_p
    kernel.GetProcAddress.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.GetProcAddress.restype = ctypes.c_void_p
    kernel.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint]
    kernel.GetModuleFileNameW.restype = ctypes.c_uint
    for dll, symbols in imports(executable):
        handle = kernel.LoadLibraryW(dll)
        if not handle:
            print(json.dumps({'dll': dll, 'load_error': ctypes.get_last_error()}), flush=True)
            continue
        resolved = ctypes.create_unicode_buffer(32768)
        kernel.GetModuleFileNameW(handle, resolved, len(resolved))
        missing = []
        for symbol in symbols:
            encoded = symbol.encode('ascii') if isinstance(symbol, str) else None
            pointer = ctypes.cast(ctypes.c_char_p(encoded), ctypes.c_void_p) if encoded else ctypes.c_void_p(symbol)
            if not kernel.GetProcAddress(handle, pointer):
                missing.append(symbol)
        print(json.dumps({'dll': dll, 'loaded_from': resolved.value, 'missing': missing}), flush=True)


if __name__ == '__main__':
    result = subprocess.run(['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib', '--no-run', '--message-format=json'], text=True, stdout=subprocess.PIPE)
    if result.returncode:
        sys.exit(result.returncode)
    executables = []
    for line in result.stdout.splitlines():
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get('reason') == 'compiler-artifact' and message.get('profile', {}).get('test') and message.get('executable'):
            executables.append(message['executable'])
    if not executables:
        raise RuntimeError('No Rust test executable found')
    for executable in executables:
        print('TEST_EXECUTABLE=' + executable, flush=True)
        diagnose(executable)
        completed = subprocess.run([executable, '--list'])
        print(f'TEST_EXIT_CODE=0x{completed.returncode & 0xffffffff:08x}', flush=True)
