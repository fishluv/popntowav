const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LibSampleRate = require('@alexanderolsen/libsamplerate-js');
const wav = require("wav");
const yargs = require("yargs");

const MSADPCM = require("./msadpcm");
const Popnchart = require("./popnchart");
const Twodx = require("./twodx");

const diffShortToLong = {
    ep: "easy",
    np: "normal",
    hp: "hyper",
    op: "ex",
};

const diffLongToShort = {
    easy: "ep",
    normal: "np",
    hyper: "hp",
    ex: "op",
};

const argv = yargs(process.argv.slice(2))
    .usage("Usage: node $0 [-i <ifs_file_or_dir> [--keep-ifs-dir] [-d <difficulty>]] [--bin-file <bin_file> --2dx-file <2dx_file>] [<output_file>]")
    .options({
        "i": {
            alias: "ifs-file-or-dir",
            describe: "ifs file or dir to use. If file is provided, ifstools will be used to extract it. Must not be used with bin file and 2dx file options.",
            type: "string",
        },
        "k": {
            alias: "keep-ifs-dir",
            describe: "Ignored unless ifs file is provided. By default, extracted ifs dir is deleted after processing. If this option is present, deletion will be skipped.",
            type: "boolean",
        },
        "d": {
            alias: "difficulty",
            describe: "Ignored unless ifs file or dir is provided. Specifies which chart to use. Defaults to normal.",
            choices: ["easy", "normal", "hyper", "ex"],
        },
        "b": {
            alias: "bin-file",
            describe: ".bin chart file to use. Must be used with 2dx file option.",
            type: "string",
        },
        "t": {
            alias: "2dx-file",
            describe: ".2dx sample archive file to use. Must be used with bin file option.",
            type: "string",
        },
    })
    .conflicts("i", ["b", "t"])
    .implies("b", "t")
    .implies("t", "b")
    .example([
        ["-- IFS MODE"],
        ["$0 -i v.ifs", "Extract and render V using its normal chart."],
        ["$0 -i v.ifs /path/v.wav", "You can specify an output path at the end."],
        ["$0 -i v.ifs -d ex", "Re-extract and render using the ex chart instead."],
        ["$0 -i v.ifs -k", "Keep the ifs dir for future renders."],
        ["$0 -i v.ifs", "This time extraction will be skipped since the ifs dir already exists."],
        ["$0 -i v_ifs/", "You can also provide the ifs dir path."],
        ["-- BIN/2DX MODE"],
        ["$0 -b v_np.bin -t v.2dx", "You can also skip the ifs business altogether by specifying the .bin and .2dx files directly."],
    ])
    .hide("version")
    .alias("h", "help")
    .parse();

if (argv.ifsFileOrDir && !fs.existsSync(argv.ifsFileOrDir)) {
    console.log("specified ifs file or dir not found");
    process.exit(1);
}
if (argv.binFile && !fs.existsSync(argv.binFile)) {
    console.log("specified bin file not found");
    process.exit(1);
}
if (argv["2dxFile"] && !fs.existsSync(argv["2dxFile"])) {
    console.log("specified 2dx file not found");
    process.exit(1);
}
if (!argv.ifsFileOrDir && (!argv.binFile || !argv["2dxFile"])) {
    console.log("must specify (ifs_file_or_dir) OR (bin_file AND 2dx_file)");
    process.exit(1);
}

const difficulty = argv.difficulty || "normal";

let dirToCleanUp;
let twodxFile;
let chartFile;
let outputFile = argv._[0];

if (argv.ifsFileOrDir) {
    const ifsName = path.basename(argv.ifsFileOrDir).slice(0, -4); // Remove `.ifs` or `_ifs` suffix

    let ifsDir;
    if (fs.statSync(argv.ifsFileOrDir).isDirectory()) {
        ifsDir = argv.ifsFileOrDir;
    } else {
        ifsDir = `${ifsName}_ifs`;
        if (fs.existsSync(ifsDir)) {
            console.log("ifs dir already exists. reusing and will not delete afterwards.")
        } else {
            child_process.execSync(`ifstools ${argv.ifsFileOrDir}`);
            if (!argv.keepIfsDir) {
                dirToCleanUp = ifsDir;
            }
        }
    }

    const availableCharts =
        Object.entries(diffShortToLong)
            .filter(([short, _]) => fs.existsSync(path.join(ifsDir, `${ifsName}_${short}.bin`)))
            .map(([_, long]) => long);

    if (!availableCharts.includes(difficulty)) {
        console.log(`ifs file contains no ${difficulty} chart. available charts: ${availableCharts.join(", ")}`);
        if (!argv.keepIfsDir) {
            fs.rmSync(ifsDir, {recursive: true});
        }
        process.exit(1);
    }

    twodxFile = path.join(ifsDir, `${ifsName}.2dx`);
    chartFile = path.join(ifsDir, `${ifsName}_${diffLongToShort[difficulty]}.bin`);
    outputFile ||= `${ifsName}_${difficulty}.wav`;
} else {
    if (argv.difficulty) {
        console.log("ignoring specified difficulty because .bin and .2dx files were specified");
    }
    twodxFile = argv["2dxFile"];
    chartFile = argv.binFile;
    outputFile ||= `${path.basename(chartFile, ".bin")}.wav`;
}

let soundContainer = new Twodx(twodxFile);
let chart = new Popnchart(chartFile, !soundContainer.late_bg);
//The sound container is full of MSADPCM keysounds, so each one needs decoded.
let decodedKeysounds = soundContainer.keysounds.map((keysound) => MSADPCM.decodeKeysoundOut(keysound.data, keysound.unk2));

let highestSample = 0;
//Outputting stereo 44.1Khz regardless.
const channels = 2;
const samplingRate = 44100;
//Because Int32.    
const bytes = 4;

//After loading in all the keysounds, we need to find ones that
//aren't 44.1KHz, since they'll mess everything up.
//Best resampling option I could find was node-libsamplerate.
//I'm sure other people have better suggestions.
function resample(keysound) {
    if (keysound.samplingRate != samplingRate) {
        return LibSampleRate.create(channels, keysound.samplingRate, samplingRate, {
            converterType: LibSampleRate.ConverterType.SRC_SINC_BEST_QUALITY,
        }).then((src) => {
            let inputFloatData = new Float32Array(keysound.data);
            let outputFloatData = src.simple(inputFloatData);
            keysound.data = Buffer.from(outputFloatData);
            src.destroy(); // clean up
        });
    } else {
        return keysound;
    }
}

Promise.all(decodedKeysounds.map(resample)).then(resampledKeysounds => {
//Gotta find the proper endOfSong
//Trying to do this by getting the largest offset,
//and then adding its associated keysound length
//to get the true ending.
let buffSize = 0;
for (const event of chart.playEvents) {
    const [offset, keysoundNo] = event;
    let off = parseInt((offset*samplingRate)/1000)*channels*bytes;
    const keysound = resampledKeysounds[keysoundNo];
    if (keysound) {
        if ((off + (keysound.data.length)*2) > buffSize) {
            buffSize = off + (keysound.data.length*2);
        }
    }
}

//Creating a buffer to store Int32s.
//This is overcompensating to deal with overflow from digital summing.
//Final Timestamp in milliseconds * sampling rate * 2 channels * 4 bytes.
const finalBuffer = Buffer.alloc(buffSize);
for (const event of chart.playEvents) {
    const [offset, keysoundNo] = event;
    //Grabbing the relevant offset for the buffer.
    const convertedOffset = parseInt((offset*samplingRate)/1000)*channels*bytes;
    const keysound = resampledKeysounds[keysoundNo];

    if (keysound) {
        const keysoundData = keysound.data;
        for (var i = 0; i<keysoundData.length; i += 2) {
            const keysoundBytes = keysoundData.readInt16LE(i);
            const finalBytes = finalBuffer.readInt32LE(convertedOffset+(i*2));
            let mixedBytes = keysoundBytes+finalBytes;
    
            highestSample = Math.max(Math.abs(mixedBytes), highestSample);
            finalBuffer.writeInt32LE(mixedBytes, convertedOffset+(i*2));
        }
    }
}

//We've got summed 16bit values, which means they won't fit into a 16bit buffer.
//We also can't just shove them into a 32bit buffer, since they're 16bit scale.
//Instead, we'll have to normalise them first using the peak observed volume.
//2147483647 is just so I don't have to import a MAX_INT32 module.
//After normalising, these values will be scaled correctly from 16bit to 32bit.
const normaliseFactor = parseInt(2147483647/highestSample);
for (var i = 0; i<finalBuffer.length; i += 4) {
    const buffBytes = finalBuffer.readInt32LE(i) * normaliseFactor;
    finalBuffer.writeInt32LE(buffBytes, i);
}

//The 2dx container names usually contain null bytes too.
let filename = soundContainer.name;
filename = filename.slice(0, filename.indexOf("\u0000"));

console.log(`outputting to ${outputFile}`);
//I could manually generate a wav header, but I don't because I'm lazy.
let writer = new wav.FileWriter(outputFile, {bitDepth: 32});
writer.write(finalBuffer);

if (dirToCleanUp) {
    fs.rmSync(dirToCleanUp, {recursive: true});
}
});
