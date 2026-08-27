with import <nixpkgs> { };

mkShell {
  nativeBuildInputs = [
    python312
    uv
  ];

  shellHook = ''
    export UV_PYTHON=${python312}/bin/python3
  '';
}
