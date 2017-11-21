import assert from "./assert";
import { scheduleRehydration } from "./vm";
import { markComponentAsDirty } from "./component";
import { isUndefined, create, ArrayIndexOf, ArrayPush } from "./language";

const TargetToReactiveRecordMap: Map<Object, ReactiveRecord> = new WeakMap();

export function notifyListeners(target: Object, key: string | Symbol) {
    const reactiveRecord = TargetToReactiveRecordMap.get(target);
    if (reactiveRecord) {
        const value = reactiveRecord[key];
        if (value) {
            const len = value.length;
            for (let i = 0; i < len; i += 1) {
                const vm = value[i];
                if (process.env.NODE_ENV !== 'production') {
                    assert.vm(vm);
                }
                if (!vm.isDirty) {
                    markComponentAsDirty(vm);
                    scheduleRehydration(vm);
                }
            }
        }
    }
}

export function subscribeToSetHook(vm: VM, target: Object, key: string | Symbol) {
    if (process.env.NODE_ENV !== 'production') {
        assert.vm(vm);
    }
    let reactiveRecord: ReactiveRecord = TargetToReactiveRecordMap.get(target);
    if (isUndefined(reactiveRecord)) {
        const newRecord: ReactiveRecord = create(null);
        reactiveRecord = newRecord;
        TargetToReactiveRecordMap.set(target, newRecord);
    }
    let value = reactiveRecord[key];
    if (isUndefined(value)) {
        value = [];
        reactiveRecord[key] = value;
    } else if (value[0] === vm) {
        return; // perf optimization considering that most subscriptions will come from the same vm
    }
    if (ArrayIndexOf.call(value, vm) === -1) {
        ArrayPush.call(value, vm);
        // we keep track of the sets that vm is listening from to be able to do some clean up later on
        ArrayPush.call(vm.deps, value);
    }
}
