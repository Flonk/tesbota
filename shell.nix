with import <nixpkgs> { };

mkShell {
  nativeBuildInputs = [
    nodejs_24
    sqlite
  ];
}
