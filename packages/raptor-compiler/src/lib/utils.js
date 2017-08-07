import { extname, normalize, join, sep, basename, dirname } from 'path';
import { MODES } from './constants';
import fs from 'fs';

export { basename, dirname, join, extname };

export const DEFAULT_NS = 'x';

export function normalizeEntryPath(path) {
    path = normalize(path.replace(/\/$/, ''));
    const ext = extname(path);
    return ext ? path : join(path, path.split(sep).pop() + ext);
}

export function fileParts(filePath) {
    const filename = basename(filePath);
    const rawExt = extname(filename);
    const ext = rawExt.substring(1);
    const name = basename(filename, rawExt);
    return { name: name, ext: ext };
}

export function getSource(path, sources) {
    sources = sources || {};
    const filename = basename(path);
    const src = sources[filename] || sources[path];
    if (src) {
        return src;
    }
    return fs.readFileSync(path, 'utf8').toString();
}

export function rollupWarningOverride(warning) {
    if (warning.code && warning.code === 'UNRESOLVED_IMPORT') {
        return;
    }

    console.warn(warning.message);
}

/*
* Names and namespace mapping:
* 'foo.js' => ns: default, name: foo
* '.../foo/foo.js' => ns: default, name: foo
* '.../myns/foo/foo.js' => ns: myns, name: foo
*/
export function getQualifiedName(path, mapNamespaceFromPath) {
    const ext = extname(path);
    const parts = path.split('/');
    const name = basename(parts.pop(), ext);
    let ns = name.indexOf('-') === -1 ? DEFAULT_NS : null;
    let tmpNs = parts.pop();

    if (tmpNs === name) {
        tmpNs = parts.pop();
    }
    // If mapping folder structure override namespace
    if (tmpNs && mapNamespaceFromPath) {
        ns = tmpNs;
    }

    return {
        componentName : name,
        componentNamespace : ns
    };
}

export function normalizeOptions(options) {
    const entry = options.entry;
    const qName = getQualifiedName(entry, options.mapNamespaceFromPath);

    options.componentNamespace = options.componentNamespace || qName.componentNamespace;
    options.componentName = options.componentName || qName.componentName;
    options.normalizedModuleName = [options.componentNamespace, options.componentName].join('-');
    options.bundle = options.bundle !== undefined ? options.bundle : true;
    options.mode = options.mode || MODES.DEV;
    options.sources = options.sources || {};
    options.$metadata = {};

    return options;
}

// Merge dedupe and filter all dependencies we have found
// Any dependency without
export function mergeMetadata(metadata) {
    const dependencies = metadata.rollupDependencies;
    const labels = [];

    for (let i in metadata) {
        dependencies.push(...metadata[i].templateDependencies || []);
        dependencies.push(...metadata[i].classDependencies || []);
        labels.push(...metadata[i].labels || []);
    }

    return {
        bundleDependencies: Array.from(new Set(dependencies)),
        bundleLabels: labels
    };
}
