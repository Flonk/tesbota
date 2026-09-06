with import <nixpkgs> { };

mkShell {
  nativeBuildInputs = [
    python312
    uv
    nodejs_24
    sqlite
  ];

  shellHook = ''
    export UV_PYTHON=${python312}/bin/python3
  '';
}
