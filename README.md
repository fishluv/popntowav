# popntowav

Tool for rendering pop'n music IFS/chart files to 32-bit PCM wav.

This fork ([original repo here](https://github.com/Gi-z/popntowav)) just fixes a broken dependency and makes the entrypoint script a little more user friendly. See acknowledgements below.

## Usage

```sh
node popntowav ifs_file [--easy|--normal|--hyper|--ex] [output_file]
```

Use difficulty flags for songs with different audio for different difficulties, e.g. Neu. (If difficulty is omitted, normal will be used.)

## Acknowledgements

Thanks to [Gi-z](https://github.com/Gi-z) for the original implementation. All chart parsing and wav rendering code was written by them. See original repo for [other acknowledgements](https://github.com/Gi-z/popntowav#acknowledgements).
