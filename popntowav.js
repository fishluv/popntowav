const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LibSampleRate = require('@alexanderolsen/libsamplerate-js');
const wav = require("wav");

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

function usageAndExit() {
    console.log("Usage: node popntowav ifs_file [--easy|--normal|--hyper|--ex] [output_file]");
    process.exit();
}

if (process.argv.length < 3) {
    usageAndExit();
}

const ifsFile = process.argv[2];
const ifsName = ifsFile.slice(0, -4); // Remove `.ifs` suffix

let difficulty, outputFile;
if (process.argv.length === 3) {
    difficulty = "normal";
    outputFile = `${ifsName}_${difficulty}.wav`;
    console.log(`ifs file: ${ifsFile}`);
    console.log("difficulty not specified so defaulting to: normal");
    console.log(`output file not specified so defaulting to: ${outputFile}`);
}

if (process.argv.length === 4) {
    if (["--easy", "--normal", "--hyper", "--ex"].includes(process.argv[3])) {
        difficulty = process.argv[3].slice(2);
        outputFile = `${ifsName}_${difficulty}.wav`;
        console.log(`ifs file: ${ifsFile}`);
        console.log(`difficulty: ${difficulty}`);
        console.log(`output file not specified so defaulting to: ${outputFile}`);
    } else {
        difficulty = "normal";
        outputFile = process.argv[3];
        console.log(`ifs file: ${ifsFile}`);
        console.log("difficulty not specified so defaulting to: normal");
        console.log(`output file: ${outputFile}`);
    }
}

if (process.argv.length === 5) {
    if (["--easy", "--normal", "--hyper", "--ex"].includes(process.argv[3])) {
        difficulty = process.argv[3].slice(2);
        outputFile = process.argv[4];
        console.log(`ifs file: ${ifsFile}`);
        console.log(`difficulty: ${difficulty}`);
        console.log(`output file: ${outputFile}`);
    } else {
        usageAndExit();
    }
}

if (process.argv.length > 5) {
    usageAndExit();
}

child_process.execSync(`ifstools ${ifsFile}`);

const ifsDir = `${ifsName}_ifs`;

const availableCharts =
    Object.entries(diffShortToLong)
        .filter(([short, _]) => fs.existsSync(path.join(ifsDir, `${ifsName}_${short}.bin`)))
        .map(([_, long]) => long);
if (!availableCharts.includes(difficulty)) {
    console.log(`ifs file contains no ${difficulty} chart. available charts: ${availableCharts.join(", ")}`);
    fs.rmSync(ifsDir, {recursive: true});
    process.exit(1);
}

const twodxFile = path.join(ifsDir, `${ifsName}.2dx`);
const chartFile = path.join(ifsDir, `${ifsName}_${diffLongToShort[difficulty]}.bin`);

let soundContainer = new Twodx(twodxFile);
let chart = new Popnchart(chartFile, !soundContainer.late_bg);
//The sound container is full of MSADPCM keysounds, so each one needs decoded.
let decodedKeysounds = soundContainer.keysounds.map((keysound) => MSADPCM.decodeKeysoundOut(keysound.data, keysound.unk2));

fs.rmSync(ifsDir, {recursive: true});

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

//I could manually generate a wav header, but I don't because I'm lazy.
let writer = new wav.FileWriter(outputFile, {bitDepth: 32});
writer.write(finalBuffer);
});
