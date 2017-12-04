const { isClassMethod, isGetterClassMethod, isSetterClassMethod, staticClassProperty } = require('../utils');

const API_DECORATOR = 'api';
const PUBLIC_PROPS_CLASS_PROPERTY = 'publicProps';
const PUBLIC_METHODS_CLASS_PROPERTY = 'publicMethods';

const PUBLIC_PROP_BIT_MASK = {
    PROPERTY: 0,
    GETTER: 1,
    SETTER: 2
}

function getPropertyBitmask(classProperty) {
    const isGetter = isGetterClassMethod(classProperty);
    const isSetter = isSetterClassMethod(classProperty);

    let bitMask;
    if (isGetter) {
        bitMask = PUBLIC_PROP_BIT_MASK.GETTER;
    } else if (isSetter) {
        bitMask = PUBLIC_PROP_BIT_MASK.SETTER;
    } else {
        bitMask = PUBLIC_PROP_BIT_MASK.PROPERTY;
    }

    return bitMask;
}

function computePublicPropsConfig(publicProps) {
    const decorateProperties = publicProps.map(
        decorator => decorator.parentPath
    );

    return decorateProperties.reduce((config, property) => {
        const propertyName = property.get('key.name').node;

        // Ensure all public setters are associated with a getter
        if (isSetterClassMethod(property)) {
            const associatedGetter = decorateProperties.find(property => (
                isGetterClassMethod(property) &&
                property.get('key.name').node === propertyName
            ));

            if (!associatedGetter) {
                throw property.buildCodeFrameError(
                    `@api set ${propertyName} setter does not have associated getter.`
                )
            }
        }

        if (!(propertyName in config)) {
            config[propertyName] = {};
        }

        config[propertyName].config |= getPropertyBitmask(property);
        return config;
    }, {});
}

function computePublicMethodsConfig(publicMethods) {
    return publicMethods.map(decorator => (
        decorator.parentPath.get('key.name').node
    ));
}

module.exports = function apiVisitor ({ types: t }) {
    const decoratorVisitor = {
        Decorator(path, { publicMethods, publicProps }) {
            const isApiDecorator = path.get('expression').isIdentifier({
                name: API_DECORATOR
            });

            if (isApiDecorator) {
                path.remove();

                if (isClassMethod(path.parentPath)) {
                    publicMethods.push(path);
                } else {
                    publicProps.push(path);
                }
            }
        },
        Class(path) {
            // Only treat the current class and not the nested one
            path.skip();
        }
    };

    return {
        Class(path, state) {
            const classBody = path.get('body');
            const publicMethods = []; // paths to @api Decorator nodes for class methods
            const publicProps = []; // paths to @api Decorator nodes for class properties

            path.traverse(decoratorVisitor, {
                publicMethods,
                publicProps,
            });

            publicProps.forEach((decoratorPath) => {
                const property = decoratorPath.parent;
                if (property.kind !== 'get') {
                    const id = property.key;
                    state.file.metadata.apiProperties.push({
                        name: id.name
                    });
                }
            });

            if (publicProps.length) {
                const publicPropsConfig = computePublicPropsConfig(publicProps);
                classBody.pushContainer('body', staticClassProperty(
                    t,
                    PUBLIC_PROPS_CLASS_PROPERTY,
                    t.valueToNode(publicPropsConfig)
                ));
            }

            if (publicMethods.length) {
                const publicMethodsConfig = computePublicMethodsConfig(publicMethods);
                classBody.pushContainer('body', staticClassProperty(
                    t,
                    PUBLIC_METHODS_CLASS_PROPERTY,
                    t.valueToNode(publicMethodsConfig)
                ));
            }
        },
    };
}
