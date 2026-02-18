"""Start server with numba stubbed out (avoids llvmlite build issues)."""
import sys
import types

# Stub numba before any imports
numba = types.ModuleType('numba')
numba.__path__ = []
numba.njit = lambda *a, **k: (lambda f: f)
numba.prange = range
numba.pndindex = lambda *a: range(0)
numba.int32 = int
numba.int64 = int
numba.float32 = float
numba.float64 = float
numba.boolean = bool
nt = types.ModuleType('numba.types')
nt.int32 = int
numba.types = nt
sys.modules['numba'] = numba
sys.modules['numba.types'] = nt

import uvicorn
uvicorn.run("server:app", host="0.0.0.0", port=8100, reload=False)
