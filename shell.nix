with import <nixpkgs> { };

mkShell {
  nativeBuildInputs = [
    python312
    uv
    nodejs_24
  ];

  shellHook = ''
    export UV_PYTHON=${python312}/bin/python3
  '';
}
