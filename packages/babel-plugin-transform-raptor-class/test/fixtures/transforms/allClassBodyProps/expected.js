export default class Text {
    publicProp;
    privateProp;

    get aloneGet() {}

    get myget() {}
    set myget(x) {
        return 1;
    }

    m1() {}
    m2() {}

    static get ctorGet() {
        return 1;
    }

    render() {}
}
Text.ctor = "ctor";
Text.publicProps = {
    publicProp: {
        config: 3
    },
    aloneGet: {
        config: 1
    },
    myget: {
        config: 3
    }
};
Text.publicMethods = ["m1"];
