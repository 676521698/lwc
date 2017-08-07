import compat from "./compat";
import assert from "./assert";
import { unwrap, MembraneSlot, TargetSlot } from "./membrane";
import { getOwnPropertySymbols, isObject, isFunction, ArraySlice, create, getPrototypeOf, setPrototypeOf, isArray, keys, getOwnPropertyNames, assign, hasOwnProperty } from "./language";

/*eslint-disable*/
import { ReplicableFunction, Replicable, Replica, Membrane } from "./membrane";

type RevokeFn = () => void;

interface RevocableProxy<T> {
    proxy: T;
    revoke: RevokeFn;
}

interface CompatProxyHandler<T extends object> {
    get(target: T, p: PropertyKey, receiver: any): any;
    set(target: T, p: PropertyKey, value: any, receiver: any): boolean;
    apply(target: T, thisArg: any, argArray?: any): any;
    construct(target: T, argArray: any, newTarget?: any): object;
}

interface CompatProxyConstructor {
    revocable<T extends object>(target: T, handler: CompatProxyHandler<T>): RevocableProxy<T>;
    new <T extends object>(target: T, handler: CompatProxyHandler<T>): T;
}
/*eslint-enable*/

function getLinkedMembrane(replicaOrAny: Replica | any): Membrane | undefined {
    const target = unwrap(replicaOrAny);
    if (target !== replicaOrAny) {
        return (replicaOrAny as Replica)[MembraneSlot];
    }
}

let lastRevokeFn: RevokeFn;

const ProxyCompat: CompatProxyConstructor = function Proxy(target: Replicable, handler: CompatProxyHandler<Replicable>): Replica {
    const targetIsFunction = isFunction(target);
    const targetIsArray = isArray(target);
    assert.invariant(isObject(target) || targetIsFunction, `Cannot create proxy with a non-object as target`);
    assert.invariant(isObject(handler), `new Proxy expects the second argument to a CompatProxyHandler`);
    const { get, set, apply, construct } = handler;
    assert.invariant(isFunction(get) && isFunction(set) && isFunction(apply) && isFunction(construct), `CompatProxyHandler requires get, set, apply and construct traps to be defined.`);

    // Construct revoke function, and set lastRevokeFn so that Proxy.revocable can steal it.
    // The caller might get the wrong revoke function if a user replaces or wraps XProxy
    // to call itself, but that seems unlikely especially when using the polyfill.
    let throwRevoked = function (trap: string) {}; // eslint-disable-line no-unused-vars
    lastRevokeFn = function () {
        throwRevoked = function (trap: string) {
            throw new TypeError(`Cannot perform '${trap}' on a proxy that has been revoked`);
        };
    };

    // Define proxy as Object, or Function (if either it's callable, or apply is set).
    let proxy = this; // reusing the already created object, eventually the prototype will be resetted
    if (targetIsFunction) {
        proxy = function Proxy() {
            const usingNew = (this && this.constructor === proxy);
            const args = ArraySlice.call(arguments);
            throwRevoked(usingNew ? 'construct' : 'apply');

            if (usingNew) {
                return construct.call(handler, target, args, this);
            } else {
                return apply.call(handler, target, this, args);
            }
        };
    }

    function linkProperty(target: Replicable, handler: CompatProxyHandler<Replicable>, key: string | Symbol, enumerable: boolean) {
        // arrays are usually mutable, but objects are not... normally, in compat mode they will use the accessor keys
        // instead of interacting with the object directly, but if they bypass that for some reason, having the right
        // value for configurable helps to detect those early errors.
        const configurable = targetIsArray;
        const desc = {
            enumerable,
            configurable,
            get: () => {
                throwRevoked('get');
                return get.call(handler, target, key);
            },
            set: (value: any): any => {
                throwRevoked('set');
                const result = set.call(handler, target, key, value);
                if (result === false) {
                    throw new TypeError(`'set' on proxy: trap returned falsish for property '${key}'`);
                }
            },
        };
        Object.defineProperty(proxy, key, desc);
    }

    // Clone enumerable properties
    for (let key in target) {
        linkProperty(target, handler, key, true);
    }

    // Set the prototype, or clone all prototype methods (always required if a getter is provided).
    const proto = getPrototypeOf(target);
    setPrototypeOf(proxy, proto);

    if (targetIsArray) {
        linkProperty(target, handler, 'length', false);
    }

    linkProperty(target, handler, MembraneSlot, false);
    linkProperty(target, handler, TargetSlot, false);

    return proxy;
};

ProxyCompat.revocable = function (target: Replicable, handler: CompatProxyHandler<Replicable>): RevocableProxy<any> {
    const p = new XProxy(target, handler);
    return {
        proxy: p,
        revoke: lastRevokeFn,
    };
};

function getKeyCompat(replicaOrAny: Replica | any, key: any): any {
    const membrane = getLinkedMembrane(replicaOrAny);
    return membrane ? membrane.get(unwrap(replicaOrAny), key) : replicaOrAny[key];
}

function callKeyCompat(replicaOrAny: Replica | any, key: any, ...args: any[]): any {
    const membrane = getLinkedMembrane(replicaOrAny);
    const context = membrane ? unwrap(replicaOrAny) : replicaOrAny;
    const fn = membrane ? membrane.get(context, key) : replicaOrAny[key];
    return fn.apply(replicaOrAny, args);
}

function setKeyCompat(replicaOrAny: Replica | any, key: string | Symbol, newValue: any, originalReturnValue?: any): any {
    const membrane = getLinkedMembrane(replicaOrAny);
    if (membrane) {
        membrane.set(unwrap(replicaOrAny), key, newValue);
    } else {
        // non-proxified assignment
        replicaOrAny[key] = newValue;
    }
    return arguments.length === 4 ? originalReturnValue : newValue;
}

function deleteKeyCompat(replicaOrAny: Replica | any, key: string | Symbol) {
    const membrane = getLinkedMembrane(replicaOrAny);
    if (membrane) {
        membrane.deleteProperty(unwrap(replicaOrAny), key);
        return;
    }
    // non-profixied delete
    delete replicaOrAny[key];
}

const inOperator = typeof Symbol() === 'object' ? function inOperatorCompat(obj: any, key: string | symbol): boolean {
    // proto chain check because this is using a broken polyfill
    // https://github.com/Financial-Times/polyfill-service/blob/master/polyfills/Symbol/
    // In this case, because this polyfill is assing all the stuff to Object.prototype to keep
    // all the other invariants of Symbols, we need to do some manual checks here for the slow patch.
    if (key && key.constructor === Symbol) {
        while (obj) {
            if (getOwnPropertySymbols(obj).indexOf(key as symbol) !== -1) {
                return true;
            }
            obj = getPrototypeOf(obj);
        }
        return false;
    }
    return key in obj;
} : function inOperator(obj: any, key: string | symbol): boolean {
    return key in obj;
}

function inKeyCompat(replicaOrAny: Replica | any, key: string | symbol): boolean {
    const membrane = getLinkedMembrane(replicaOrAny);
    if (membrane) {
        return membrane.has(unwrap(replicaOrAny), key);
    }
    return inOperator(replicaOrAny, key);
}

function iterableKeyCompat(replicaOrAny: Replica | any): any[] {
    const membrane = getLinkedMembrane(replicaOrAny);
    const target = membrane ? unwrap(replicaOrAny) : replicaOrAny;
    const keyedObj = create(null);
    for (let i in target) {
        keyedObj[i] = void 0;
    }
    return keyedObj;
}

// transpilation
// 1. member expressions e.g.: `obj.x.y.z` => `getKey(obj, 'x', 'y', 'z')`
// 2. assignment of member expressions e.g.: `obj.x.y.z = 1;` => `setKey(getKey(obj, 'x', 'y'), 'z', 1)`
// 3. delete operator e.g.: `delete obj.x.y.z` => `deleteKey(getKey(obj, 'x', 'y'), 'z')`
// 4. in operator e.g.: `"z" in obj.x.y` => `inKey(getKey(obj, 'x', 'y'), 'z')`
// 5. for in operator `for (let i in obj)` => `for (let i in iterableKey(obj))`

// patches
// [*] Object.prototype.hasOwnProperty should be patched as a general rule
// [ ] Object.propertyIsEnumerable should be patched
// [*] Array.isArray

function compatIsArray(replicaOrAny: Replica | any): boolean {
    return isArray(unwrap(replicaOrAny));
}

function compatKeys(replicaOrAny: Replica | any): Array<string | Symbol> {
    return keys(unwrap(replicaOrAny));
}

function compatGetOwnPropertyNames(replicaOrAny: Replica | any): Array<string> {
    return getOwnPropertyNames(unwrap(replicaOrAny));
}

function compatHasOwnProperty(key: string | Symbol): boolean {
    const replicaOrAny: Replica | any = this;
    return hasOwnProperty.call(unwrap(replicaOrAny), key);
}

function compatAssign(replicaOrAny: Replica | any): Replica | any {
    if (replicaOrAny == null) { // TypeError if undefined or null
      throw new TypeError('Cannot convert undefined or null to object');
    }

    const to = Object(unwrap(replicaOrAny));

    for (var index = 1; index < arguments.length; index++) {
        const nextSource = arguments[index];

        if (nextSource != null) { // Skip over if undefined or null
            const iterator = unwrap(nextSource);
            for (let nextKey in iterator) {
                // Avoid bugs when hasOwnProperty is shadowed
                if (hasOwnProperty.call(iterator, nextKey)) {
                    setKey(to, nextKey, getKey(nextSource, nextKey));
                }
            }
        }
    }
    return to;
}

// trap `preventExtensions` can be covered by a patched version of:
// [ ] Object.preventExtensions()
// [ ] Reflect.preventExtensions()

// trap `getOwnPropertyDescriptor` can be covered by a patched version of:
// [ ] Object.getOwnPropertyDescriptor()
// [ ] Reflect.getOwnPropertyDescriptor()

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/defineProperty
// trap `defineProperty` can be covered by a patched version of:
// [ ] Object.defineProperty()
// [ ] Reflect.defineProperty()


// trap `deleteProperty` can be covered by the transpilation and the patched version of:
// [ ] Reflect.deleteProperty()

// trap `ownKeys` can be covered by a patched version of:
// [*] Object.getOwnPropertyNames()
// [ ] Object.getOwnPropertySymbols()
// [*] Object.keys()
// [ ] Reflect.ownKeys()

// trap `isExtensible` can be covered by a patched version of:
// [ ] Object.isExtensible()
// [ ] Reflect.isExtensible()

// trap `setPrototypeOf` can be covered by a patched version of:
// [ ] Object.setPrototypeOf()
// [ ] Reflect.setPrototypeOf()

export let XProxy: CompatProxyConstructor = typeof Proxy !== "undefined" ? Proxy : undefined;
export let getKey;
export let callKey;
export let setKey;
export let deleteKey;
export let inKey;
export let iterableKey;

// enable/disable is meant to be used by our test infrastructure only
export function enableCompatMode() {
    XProxy = ProxyCompat;
    getKey = getKeyCompat;
    callKey = callKeyCompat;
    setKey = setKeyCompat;
    deleteKey = deleteKeyCompat;
    inKey = inKeyCompat;
    iterableKey = iterableKeyCompat;
    Array.isArray = compatIsArray;
    assign(Object, {
        keys: compatKeys,
        getOwnPropertyNames: compatGetOwnPropertyNames,
        assign: compatAssign,
    })
    assign(Object.prototype, {
        hasOwnProperty: compatHasOwnProperty,
    })
}

export function disableCompatMode() {
    XProxy = Proxy;
    getKey = setKey = deleteKey = inKey = iterableKey = undefined;
    Array.isArray = isArray;
    assign(Object, {
        keys,
        getOwnPropertyNames,
        assign,
    });
    assign(Object.prototype, {
        hasOwnProperty,
    })
}

// initialization
compat(() => {
    enableCompatMode();
});
