/* eslint-env node */

const path = require('path');
const typescript = require('rollup-plugin-typescript');

const { version } = require('./package.json');
const { generateTargetName } = require('./rollup.config.util');

const entry = path.resolve(__dirname, 'src/main.js');
const commonJSDirectory = path.resolve(__dirname, 'dist/commonjs');
const modulesDirectory = path.resolve(__dirname, 'dist/modules');

const banner = (
    `/*
    * Copyright (C) 2017 salesforce.com, inc.
    */
    `
);
const footer = `/** version: ${version} */`;


function rollupConfig(config) {
    const { format, target } = config;

    const targetName = generateTargetName(config);
    const targetDirectory = (format === 'es' ? modulesDirectory : commonJSDirectory) + `/${target}`;

     return {
        name: 'wire-service',
        banner: banner,
        footer: footer,
        input: entry,
        output: {
            file: path.join(targetDirectory, targetName),
            format: format,
        },
        plugins: [
            typescript({
                target: target,
                typescript: require('typescript'),
            }),
        ]
    }
}

module.exports = [
    rollupConfig({ format:'es', target:'es2017' }),
    rollupConfig({ format:'cjs', target:'es2017' }),
    rollupConfig({ format: 'cjs', target: 'es5' }),
];
