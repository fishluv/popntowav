# popntowav

Tool for rendering pop'n music IFS/chart files to 32-bit PCM wav.

This fork ([original repo here](https://github.com/Gi-z/popntowav)) just fixes a broken dependency and makes the entrypoint script a little more user friendly. See acknowledgements below.

## Usage

```sh
node popntowav [-i <ifs_file_or_dir> [-k] [-d <difficulty>]]
        [-b <bin_file> -t <2dx_file>] [<output_file>]
```

Supports two different modes:

1. `ifs mode` - **Specify .ifs file or \_ifs/ directory.** Optionally specify a chart difficulty. (Useful for songs with different audio for different difficulties, e.g. Neu. If omitted, difficulty will default to normal.)
2. `bin/2dx mode` - **Specify .bin file and .2dx file.** (No difficulty needed since a .bin file already maps to a single difficulty.)

See `node popntowav -h` for more details.

## Acknowledgements

Thanks to [Gi-z](https://github.com/Gi-z) for the original implementation. All chart parsing and wav rendering code was written by them. See original repo for [other acknowledgements](https://github.com/Gi-z/popntowav#acknowledgements).
