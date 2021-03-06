"use strict";

/**
 * @module opcua.address_space
 */
require("requirish")._(module);

var NodeClass = require("lib/datamodel/nodeclass").NodeClass;
var NodeId = require("lib/datamodel/nodeid").NodeId;
var makeNodeId  = require("lib/datamodel/nodeid").makeNodeId;
var resolveNodeId = require("lib/datamodel/nodeid").resolveNodeId;


var DataValue = require("lib/datamodel/datavalue").DataValue;
var DataType = require("lib/datamodel/variant").DataType;
var StatusCodes = require("lib/datamodel/opcua_status_code").StatusCodes;

var AttributeIds = require("lib/datamodel/attributeIds").AttributeIds;


var translate_service = require("lib/services/translate_browse_paths_to_node_ids_service");
var BrowsePathResult =translate_service.BrowsePathResult;
var BrowsePath =translate_service.BrowsePath;

var assert  = require("better-assert");
var util = require("util");
var _ = require("underscore");

var dumpIf = require("lib/misc/utils").dumpIf;


var BaseNode = require("lib/address_space/basenode").BaseNode;
var ReferenceType= require("lib/address_space/referenceType").ReferenceType;
var Variable = require("lib/address_space/variable").Variable;
var VariableType = require("lib/address_space/variableType").VariableType;
var ObjectType = require("lib/address_space/objectType").ObjectType;
var BaseObject = require("lib/address_space/baseObject").BaseObject;
var Method = require("lib/address_space/method").Method;
var UADataType = require("lib/address_space/data_type").UADataType;

var View = require("lib/address_space/view").View;

var _constructors = {};

function registerConstructor(ConstructorFunc, nodeId) {
    ConstructorFunc.prototype.typeDefinition = resolveNodeId(nodeId+"Node");
    _constructors[ConstructorFunc.prototype.typeDefinition.toString()] = ConstructorFunc;
}
registerConstructor(Variable, "VariableType");



/**
 * `AddressSpace` is a collection of UA nodes.
 *
 *     var address_space = new AddressSpace();
 *
 *
 * @class AddressSpace
 * @constructor
 */
function AddressSpace() {
    this._nodeid_index = {};
    this._aliases = {};
    this._objectTypeMap = {};
    this._objectMap = {};
    this._variableTypeMap = {};
    this._referenceTypeMap = {};
    this._referenceTypeMapInv = {};
    this._dataTypeMap = {};

    this._private_namespace = 1;
    this._internal_id_counter = 1000;
}

/**
 *
 * @method add_alias
 * @param alias_name {String} the alias name
 * @param nodeId {NodeId}
 */
AddressSpace.prototype.add_alias = function(alias_name,nodeId) {
    assert(typeof alias_name === "string");
    assert(nodeId instanceof NodeId);
    this._aliases[alias_name] = nodeId;
};

/**
 * find an object by node Id
 * @method findObject
 * @param nodeId {NodeId|String}  a nodeId or a string coerce-able to nodeID, representing the object to find.
 * @return {BaseNode}
 */
AddressSpace.prototype.findObject = function (nodeId) {
    nodeId = this.resolveNodeId(nodeId);
    return this._nodeid_index[nodeId.toString()];
};

AddressSpace.prototype.findMethod = function(nodeId) {
    var obj= this.findObject(nodeId);
    assert(obj instanceof Method);
    return obj;
};

/**
 *
 * @method findObjectByBrowseName
 * @param browseNameToFind {String}
 * @return {BaseNode}
 */
AddressSpace.prototype.findObjectByBrowseName = function(browseNameToFind) {

    var bucket =  this._objectMap[browseNameToFind];
    if (!bucket) { return null; }

    var bucketKeys = Object.keys(bucket);

    if (bucketKeys.length > 1) {
        // use parent[browseName]
        // or address_space.findObject(nodeId) instead
        throw new Error("findObjectByBrowseName found more than one item with name " +browseNameToFind);
    }
    return bucket[bucketKeys[0]];

};

function _registerObject(self,object) {

    var bucket = self._objectMap[object.browseName];
    if (!bucket) {
        bucket = {};
        self._objectMap[object.browseName] = bucket;
    }
    bucket[object.nodeId.toString()] = object;
}

function _unregisterObject(self,object) {
    var bucket = self._objectMap[object.browseName];
    if (bucket) {
        delete bucket[object.nodeId.toString()];
    }
}

function _registerObjectType(self,object) {

    assert(!self._objectTypeMap[object.browseName]," ObjectType already declared");
    self._objectTypeMap[object.browseName] = object;

}

function _registerVariableType(self,object) {

    assert(!self._variableTypeMap[object.browseName]," VariableType already declared");
    self._variableTypeMap[object.browseName] = object;

}

function _registerReferenceType(self,object) {

    assert(typeof object.browseName === "string");
    assert(object.inverseName.text);
    assert(!self._referenceTypeMap[object.browseName], " Object already declared");
    assert(!self._referenceTypeMapInv[object.inverseName], " Object already declared");
    self._referenceTypeMap[object.browseName] = object;
    self._referenceTypeMapInv[object.inverseName.text] = object;
}

function _registerDataType(self,object) {
    assert(!self._dataTypeMap[object.browseName], " DataType already declared");
    self._dataTypeMap[object.browseName] = object;
}


AddressSpace.prototype._register = function (object) {

    assert(object.nodeId instanceof NodeId);
    assert(object.nodeId);
    assert(object.hasOwnProperty("browseName"));

    var indexName = object.nodeId.toString();
    if (this._nodeid_index.hasOwnProperty(indexName)) {
        throw new Error("nodeId "  + object.nodeId.displayText() +  " already registered " + object.nodeId.toString());
    }

    this._nodeid_index[indexName] = object;



    if (object.nodeClass === NodeClass.ObjectType) {
        _registerObjectType(this,object);

    } else if (object.nodeClass === NodeClass.VariableType) {
        _registerVariableType(this,object);

    } else if (object.nodeClass === NodeClass.Object) {
        _registerObject(this,object);

    } else if (object.nodeClass === NodeClass.Variable) {
        _registerObject(this,object);

    } else if (object.nodeClass === NodeClass.Method) {
        _registerObject(this,object);

    } else if (object.nodeClass === NodeClass.ReferenceType) {
        _registerReferenceType(this, object);

    } else if (object.nodeClass === NodeClass.DataType) {
        _registerDataType(this,object);

    } else if (object.nodeClass === NodeClass.View) {
        _registerDataType(this,object);

    } else {
        console.log("Invalid class Name" , object.nodeClass);
        throw new Error("Invalid class name specified");
    }

};



AddressSpace.prototype.deleteObject = function(nodeId) {

    var self = this;
    var object = this.findObject(nodeId);

    // istanbul ignore next
    if (!object) {
        throw new Error(" deleteObject : cannot find object with nodeId" + nodeId.toString());
    }

    function deleteObjectPointedByReference(ref) {
        var address_space = self;

        var o = address_space.findObject(ref.nodeId);
        address_space.deleteObject(o.nodeId);
    }
    // recursively delete all objects below in the hierarchie of objects
    var components = object.findReferences("HasComponent",true);
    var subfolders = object.findReferences("Organizes",true);
    var properties = object.findReferences("HasProperty",true);

    var rf = [].concat(components,subfolders,properties);
    rf.forEach(deleteObjectPointedByReference);


    // delete object from global index
    var indexName = nodeId.toString();
    // istanbul ignore next
    if (!this._nodeid_index.hasOwnProperty(indexName)) {
        throw new Error("deleteObject : nodeId "  + nodeId.displayText() +  " is not registered " + nodeId.toString());
    }

    delete this._nodeid_index[indexName];

    object.unpropagate_back_references(self);


    if (object.nodeClass === NodeClass.ObjectType) {
        _unregisterObjectType(this,object);

    //} else if (object.nodeClass === NodeClass.VariableType) {
    //    _unregisterVariableType(this,object);
    //
    } else if (object.nodeClass === NodeClass.Object) {
        _unregisterObject(this,object);

    } else if (object.nodeClass === NodeClass.Variable) {
        _unregisterObject(this,object);
    } else if (object.nodeClass === NodeClass.Method) {
        _unregisterObject(this,object);
    //
    //} else if (object.nodeClass === NodeClass.ReferenceType) {
    //    _registerReferenceType(this, object);
    //
    //} else if (object.nodeClass === NodeClass.DataType) {
    //    _registerDataType(this,object);
    //
    //} else if (object.nodeClass === NodeClass.View) {
    //    _registerDataType(this,object);
    //
    } else {
        console.log("Invalid class Name" , object.nodeClass);
        throw new Error("Invalid class name specified");
    }

};

/**
 * resolved a string or a nodeId to a nodeID
 *
 * @method resolveNodeId
 * @param nodeid {NodeId|String}
 * @return {NodeId}
 */
AddressSpace.prototype.resolveNodeId = function (nodeid) {

    if (typeof nodeid === "string") {
        // check if the string is a known alias
        var alias = this._aliases[nodeid];
        if (alias !== undefined) {
          return alias;
        }
    }
    return resolveNodeId(nodeid);
};

var _constructors_map = {
    "Object":            BaseObject,
    "ObjectType":        ObjectType,
    "ReferenceType":     ReferenceType,
    "Variable"     :     Variable,
    "VariableType":      VariableType,
    "DataType":          UADataType,
    "Method":            Method,
    "View":              View
};

/**
 * @method _createObject
 * @private
 * @param options
 *
 * @param options.nodeId   {NodeId}
 * @param options.nodeClass {NodeClass}
 * @param options.browseName {String}
 * @return {Object}
 * @private
 */
AddressSpace.prototype._createObject = function(options) {


    dumpIf(!options.nodeId,options); // missing node Id
    assert(options.nodeId);
    assert(options.nodeClass);
    assert(typeof options.browseName === "string");

    var Constructor = _constructors_map[options.nodeClass.key];
    if (!Constructor) {
        throw new Error(" missing constructor for NodeClass " + options.nodeClass.key);
    }

    options.address_space = this;
    var obj = new Constructor(options);
    assert(obj.nodeId);
    assert(obj.nodeId instanceof NodeId);
    this._register(obj);

    // object shall now be registered
    assert(_.isObject(this.findObject(obj.nodeId)) && " Where is object ?");
    return obj;
};


/**
 * browse some path.
 *
 * @method browsePath
 * @param  {BrowsePath} browsePath
 * @return {BrowsePathResult}
 *
 * This service can be used translates one or more browse paths into NodeIds.
 * A browse path is constructed of a starting Node and a RelativePath. The specified starting Node
 * identifies the Node from which the RelativePath is based. The RelativePath contains a sequence of
 * ReferenceTypes and BrowseNames.
 *
 *   |StatusCode                    |                                                            |
 *   |------------------------------|:-----------------------------------------------------------|
 *   |BadNodeIdUnknown              |                                                            |
 *   |BadNodeIdInvalid              |                                                            |
 *   |BadNothingToDo                | - the relative path contains an empty list )               |
 *   |BadBrowseNameInvalid          | - target name is missing in relative path                  |
 *   |UncertainReferenceOutOfServer | - The path element has targets which are in another server.|
 *   |BadTooManyMatches             |                                                            |
 *   |BadQueryTooComplex            |                                                            |
 *   |BadNoMatch                    |                                                            |
 *
 *
 */
AddressSpace.prototype.browsePath = function(browsePath) {

    var self = this;

    assert(browsePath instanceof translate_service.BrowsePath);

    var startingNode = self.findObject(browsePath.startingNode);
    if (!startingNode) {
        return new BrowsePathResult({statusCode: StatusCodes.BadNodeIdUnknown});
    }

    if(browsePath.relativePath.elements.length === 0 ) {
        return new BrowsePathResult({statusCode: StatusCodes.BadNothingToDo});
    }

    // The last element in the relativePath shall always have a targetName specified.
    var l = browsePath.relativePath.elements.length;
    var last_el = browsePath.relativePath.elements[l-1];

    if (!last_el.targetName || !last_el.targetName.name || last_el.targetName.name.length === 0) {
        return new BrowsePathResult({statusCode: StatusCodes.BadBrowseNameInvalid});
    }

    var res =[];
    function explore_element(curNodeObject,elements,index) {

        var element = elements[index];
        assert(element instanceof translate_service.RelativePathElement);

        var nodeIds = curNodeObject.browseNodeByTargetName(element);

        var targets = [];
        nodeIds.forEach(function(nodeId){
            targets.push({
                targetId: nodeId,
                remainingPathIndex: elements.length - index
            });
        });
        var is_last =( (index+1) ===  elements.length);

        if (!is_last) {
            // explorer
            targets.forEach(function(target){
                var node = self.findObject(target.targetId);
                explore_element(node,elements,index+1);
            });
        } else {
            targets.forEach(function(target){
                res.push({
                    targetId: target.targetId,
                    remainingPathIndex: 0xFFFFFFFF
                });
            });
        }
    }
    explore_element(startingNode, browsePath.relativePath.elements,0);

    if (res.length === 0 ) {
        return  new BrowsePathResult({ statusCode: StatusCodes.BadNoMatch});
    }

   return  new BrowsePathResult({
        statusCode : StatusCodes.Good,
        targets: res
    });
};

var rootFolderId = makeNodeId(84); // RootFolder


/**
 * convert a path string to a BrowsePath
 *
 * @method constructBrowsePath
 * @param startingNode {NodeId|string}
 * @param path {string} path such as Objects.Server
 * @return {BrowsePath}
 *
 * @example:
 *
 *   ```javascript
 *   constructBrowsePath("/","Objects");
 *   constructBrowsePath("/","Objects.Server");
 *   constructBrowsePath("/","Objects.4:Boilers");
 *   ```
 *
 *  - '#' : HasSubtype
 *  - '.' : Organizes , HasProperty, HasComponent, HasNotifier
 *  - '&' : HasTypeDefinition
 *
 */
function constructBrowsePath(startingNode ,path) {

    if (startingNode === "/" ) {
        startingNode = rootFolderId;
    }

    var arr = path.split(".");
    var elements = arr.map(function(browsePathElement){

        // handle browsePathElement with namespace indexes
        var split_array = browsePathElement.split(":");
        var namespaceIndex=0;
        if (split_array.length === 2) {
            namespaceIndex = parseInt(split_array[0]);
            browsePathElement = split_array[1];
        }

        return {
            referenceTypeId: makeNodeId(0),
            isInverse: false,
            includeSubtypes: false,
            targetName: { namespaceIndex:namespaceIndex, name: browsePathElement}
        };
    });

    var browsePath = new BrowsePath({
        startingNode: rootFolderId, // ROOT
        relativePath: {
            elements: elements
        }
    });
    return browsePath;
}
exports.constructBrowsePath = constructBrowsePath;

/**
 * a simplified version of browsePath that takes a path as a string
 * and returns a single node or null if not found.
 * @method simpleBrowsePath
 * @param startingNode
 * @param pathname
 * @return {BrowsePathTarget}
 */
AddressSpace.prototype.simpleBrowsePath = function(startingNode,pathname) {
    var browsePath = constructBrowsePath(startingNode,pathname);
    var browsePathResult = this.browsePath(browsePath);
    if (browsePathResult.statusCode !== StatusCodes.Good) {
        return null; // not found
    } else {
        assert(browsePathResult.targets.length >= 1);
        browsePathResult.targets[browsePathResult.targets.length-1].remainingPathIndex.should.equal(0xFFFFFFFF);
        return browsePathResult.targets[browsePathResult.targets.length-1].targetId;
    }
};


AddressSpace.prototype.findDataType = function(browseName) {
   // startingNode i=24  :
   // BaseDataType
   // +-> Boolean (i=1) {BooleanDataType (ns=2:9898)
   // +-> String (i=12)
   //     +->NumericRange
   //     +->Time
   // +-> DateTime
   // +-> Structure
   //       +-> Node
   //            +-> ObjectNode
  return this._dataTypeMap[browseName];
};

AddressSpace.prototype.findObjectType = function(browseName){
    return this._objectTypeMap[browseName];
};

AddressSpace.prototype.findVariableType = function(browseName){
    return this._variableTypeMap[browseName];
};

/**
 * returns true if str matches a node
 * @param str
 * @returns {boolean}
 */
function isNodeIdString(str) {
 return str.substring(0,2) === "i=" || str.substring(0,3) === "ns=";
}
/**
 * @method findReferenceType
 * @param refType {String}
 * @return {ReferenceType|null}
 *
 * refType could be
 *    a string representing a nodeid       : e.g.    'i=9004' or ns=1;i=6030
 *    a string representing a browse name  : e.g     'HasTypeDefinition'
 *      in this case it should be in the alias list
 *
 */
AddressSpace.prototype.findReferenceType = function(refType) {
    // startingNode ns=0;i=31 : References
    //  References i=31
    //  +->(hasSubtype) NoHierarchicalReferences
    //                  +->(hasSubtype) HasTypeDefinition
    //  +->(hasSubtype) HierarchicalReferences
    //                  +->(hasSubtype) HasChild/ChildOf
    //                                  +->(hasSubtype) Aggregates/AggregatedBy
    //                                                  +-> HasProperty/PropertyOf
    //                                                  +-> HasComponent/ComponentOf
    //                                                  +-> HasHistoricalConfiguration/HistoricalConfigurationOf
    //                                 +->(hasSubtype) HasSubtype/HasSupertype
    //                  +->(hasSubtype) Organizes/OrganizedBy
    //                  +->(hasSubtype) HasEventSource/EventSourceOf
    var object,nodeId;

    if ( isNodeIdString(refType)) {
        nodeId = resolveNodeId(refType);
        object = this.findObject(nodeId);
        assert(object&& (object.nodeClass === NodeClass.ReferenceType) );
    } else {
        object = this._referenceTypeMap[refType];
        assert(!object || (object.nodeClass === NodeClass.ReferenceType && object.browseName === refType) );
    }
    return object;
};

/**
 * find a ReferenceType by its inverse name.
 * @method findReferenceTypeFromInverseName
 * @param inverseName {String} the inverse name of the ReferenceType to find
 * @return {ReferenceType}
 */
AddressSpace.prototype.findReferenceTypeFromInverseName = function(inverseName) {

    var object = this._referenceTypeMapInv[inverseName];
    assert(!object || (object.nodeClass === NodeClass.ReferenceType && object.inverseName.text === inverseName) );
    return object;
};

/**
 * @method normalizeReferenceType
 * @param params.referenceType  {String}
 * @param params.isForward  {Boolean} default value: true;
 * @return {Object} a new object with the normalized name { referenceType: <value>, isForward: <flag>}
 */
AddressSpace.prototype.normalizeReferenceType = function(params) {
    // referenceType = Organizes   , isForward = true =>   referenceType = Organizes ,   isForward = true
    // referenceType = Organizes   , isForward = false =>  referenceType = Organizes ,   isForward = false
    // referenceType = OrganizedBy , isForward = true =>   referenceType = Organizes , isForward = **false**
    // referenceType = OrganizedBy , isForward = false =>  referenceType = Organizes , isForward =  **true**


    assert(typeof params.referenceType === "string");
    params.isForward = ( params.isForward === null ) ? true : params.isForward;

    var n1 = this.findReferenceType(params.referenceType);
    var n2 = this.findReferenceTypeFromInverseName(params.referenceType);

    if (!n1 && !n2) {
        // unknown type, there is nothing we can do about it
        return params;
    } else   if (n1) {
        assert(!n2);
        return params;
    } else {
        assert(n2);
        // make sure we preserve integrity of object passed as a argument
        var new_params = _.clone(params);
        new_params.referenceType= n2.browseName;
        new_params.isForward = ! params.isForward;
        return new_params;
    }
};

/**
 * returns the inverse name of the referenceType.
 *
 * @method inverseReferenceType
 * @param referenceType {String} : the reference type name
 * @return {String} the name of the inverse reference type.
 *
 * @example
 *
 *    ```javascript
 *    address_space.inverseReferenceType("OrganizedBy").should.eql("Organizes");
 *    address_space.inverseReferenceType("Organizes").should.eql("OrganizedBy");
 *    ```
 *
 */
AddressSpace.prototype.inverseReferenceType = function(referenceType) {

    assert( typeof referenceType === "string");

    var n1 = this.findReferenceType(referenceType);
    var n2 = this.findReferenceTypeFromInverseName(referenceType);
    if (n1) {
        assert(!n2);
        return n1.inverseName.text;
    } else {
        assert(n2);
        return n2.browseName;
    }
};



//----------------------------------------------------------------------------------------------------------------------

AddressSpace.prototype._build_new_NodeId = function () {
    var nodeId = makeNodeId(this._internal_id_counter, this._private_namespace);
    this._internal_id_counter += 1;
    return nodeId;
};

var DataTypeIds = require("lib/opcua_node_ids").DataTypeIds;
var VariableTypeIds = require("lib/opcua_node_ids").VariableTypeIds;


AddressSpace.prototype._coerce_Type = function(dataType,typeMap,typeMapName) {

    assert(_.isObject(typeMap));
    var self = this;
    var nodeId;
    if (typeof dataType === "string") {
        // resolve dataType
        nodeId = self._aliases[dataType];
        if (!nodeId) {
            // dataType was not found in the aliases database

            if (typeMap[dataType]) {
                nodeId= makeNodeId(typeMap[dataType],0);
                return nodeId;
            } else {
                nodeId = resolveNodeId(dataType);
            }
        }
    } else if (typeof dataType === "number") {
        nodeId = makeNodeId(dataType,0);
    } else {
        nodeId = resolveNodeId(dataType);
    }

    assert(nodeId instanceof NodeId);
    assert(nodeId.namespace === 0);
    // verify that node Id exists in typeMap
    var find = _.filter(typeMap,function(a)  {return a === nodeId.value;});

    /* istanbul ignore next */
    if (find.length !== 1) {
        //xxx console.log("xxx cannot find ",dataType ," in ",typeMapName);
        //xxx console.log(_.map(typeMap,function(value,key){ return key + ":" + value;}).join(" ") );
        throw new Error(" cannot find " + dataType.toString() + " in typeMap " +typeMapName);
    }
    return nodeId;
};

AddressSpace.prototype._coerce_DataType = function(dataType) {
    return this._coerce_Type(dataType,DataTypeIds,"DataTypeIds");
};

AddressSpace.prototype._coerce_VariableTypeIds = function(dataType) {
    return this._coerce_Type(dataType,VariableTypeIds,"VariableTypeIds");
};

AddressSpace.prototype._coerceTypeDefinition = function(hasTypeDefinition) {
    var self = this;
    if (typeof hasTypeDefinition === "string") {
        // coerce parent folder to an object
        hasTypeDefinition = self.findObject(hasTypeDefinition);
        hasTypeDefinition = hasTypeDefinition.nodeId;
    }
    //xx console.log("hasTypeDefinition = ",hasTypeDefinition);
    assert(hasTypeDefinition instanceof NodeId);
    return hasTypeDefinition;
};

/**
 * @method addVariable
 * @param parentObject
 * @param options
 * @param options.browseName
 * @param options.dataType
 * @returns {Object}
 */
AddressSpace.prototype._addVariable = function (parentObject,hierarchyType, options) {

    var self = this;

    if (typeof parentObject === "string" ) {
        parentObject = self._coerceFolder(parentObject);
    }

    var baseDataVariableTypeId = self.findVariableType("BaseDataVariableType").nodeId;

    assert(options.hasOwnProperty("browseName"));
    assert(options.hasOwnProperty("dataType"));
    // xx assert(self.FolderTypeId && self.BaseObjectTypeId); // is default address space generated.?
    assert(parentObject instanceof BaseNode);

    // ------------------------------------------ TypeDefinition
    var typeDefinition = options.typeDefinition || baseDataVariableTypeId;
    typeDefinition = self._coerce_VariableTypeIds(typeDefinition);
    assert(typeDefinition instanceof NodeId);

    // ------------------------------------------ DataType
    options.dataType = self._coerce_DataType(options.dataType);

    var valueRank = _.isUndefined(options.valueRank) ? -1 : options.valueRank;
    assert(_.isFinite(valueRank));
    assert(typeof(valueRank) === "number");

    var browseName = options.browseName;
    assert(typeof(browseName) === "string");

    var description = options.description || "";

    var newNodeId = options.nodeId || self._build_new_NodeId();

    options.arrayDimensions = options.arrayDimensions || null;
    assert(_.isArray(options.arrayDimensions)|| options.arrayDimensions === null);

    assert(hierarchyType === "HasComponent" || hierarchyType === "HasProperty");

    var variable = self._createObject({
        nodeId: newNodeId,
        nodeClass: NodeClass.Variable,
        dataType: options.dataType,
        browseName: browseName,
        description: description,
        valueRank: valueRank,
        accessLevel: options.accessLevel,
        userAccessLevel: options.userAccessLevel,
        historizing: options.historizing || false,
        minimumSamplingInterval: options.minimumSamplingInterval || 0,
        arrayDimensions: options.arrayDimensions,
        //xx value: value,
        references: [
            {referenceType: "HasTypeDefinition", isForward: true, nodeId: typeDefinition },
            {referenceType: hierarchyType,       isForward: false, nodeId: parentObject.nodeId }
        ]
    });
    assert(variable instanceof Variable);

    variable.propagate_back_references(self);

    //xx options.value = options.value || {};
    if (options.value) {
        variable.bindVariable(options.value);
    }
    return variable;
};

AddressSpace.prototype.addProperty = function (parent, options) {
    options.typeDefinition = options.typeDefinition || "PropertyType";
    assert(options.typeDefinition ==="PropertyType");
    return this._addVariable(parent,"HasProperty",options);
};

AddressSpace.prototype.addVariable = function (parent, options) {
    assert(!options.typeDefinition  || options.typeDefinition !=="PropertyType");
    return this._addVariable(parent,"HasComponent",options);
};

AddressSpace.prototype.addView = function (parentObject, options) {

    var self = this;

    assert(parentObject instanceof BaseNode);

    var baseDataVariableTypeId = self.findVariableType("BaseDataVariableType").nodeId;
    // ------------------------------------------ TypeDefinition
    var typeDefinition = options.typeDefinition || baseDataVariableTypeId;


    assert(options);
    assert(options.hasOwnProperty("browseName"));
    // xx assert(self.FolderTypeId && self.BaseObjectTypeId); // is default address space generated.?
    assert(parentObject instanceof BaseNode);
    var browseName = options.browseName;
    assert(typeof(browseName) === "string");
    var description = options.description || "";
    var newNodeId = options.nodeId || self._build_new_NodeId();


    var view = self._createObject({
        nodeId: newNodeId,
        nodeClass: NodeClass.View,
        browseName: browseName,
        description: description,
        references: [
            {referenceType: "HasTypeDefinition", isForward: true, nodeId: typeDefinition },
            {referenceType: "HasProperty",       isForward: false, nodeId: parentObject.nodeId }
        ]
    });
    assert(view instanceof View);

    view.propagate_back_references(self);

    return view;
};


/**
 *
 * @method getFolder
 * @param folder   {Object|String|NodeId} the folder identifier either as an object, a nodeid string, or a NodeId.
 * @return {UAObject}  hasTypeDefinition: FolderType
 */
AddressSpace.prototype.getFolder = function (folder) {
    var self = this;

    if (folder instanceof BaseNode) {
        // already a folder (?)
        // TODO make sure the folder exists in the address space and that the folder object is a Folder
        var folderTypeId = self._coerceTypeDefinition("FolderType");
        if(!(folder.hasTypeDefinition.toString() === folderTypeId.toString())) {
            throw new Error("Parent folder must be of FolderType " + folder.hasTypeDefinition.toString());
        }
        return folder;
    }

    folder = self.findObjectByBrowseName(folder) || folder;
    if (!folder || !folder.hasTypeDefinition) {
        folder = self.findObject(folder) || folder;
        if (!folder || !folder.hasTypeDefinition) {
            console.log("cannot find folder ", folder);
            return null; // canno
        }
    }
    var folderTypeId = self._coerceTypeDefinition("FolderType");
    assert(folderTypeId, " ????");
    assert(folder.hasTypeDefinition.toString() === folderTypeId.toString(), "expecting a Folder here ");
    return folder;
};

AddressSpace.prototype._coerceFolder = function(parentFolder) {
    var self = this;
    var folderTypeId = self._coerceTypeDefinition("FolderType");
    if (typeof parentFolder === "string") {
        // coerce parent folder to an object
        parentFolder = self.getFolder(parentFolder);
    }
    // istanbul ignore next
    if(!(parentFolder.hasTypeDefinition.toString() === folderTypeId.toString())) {
        throw new Error("Parent folder must be of FolderType " + parentFolder.hasTypeDefinition.toString());
    }
    return parentFolder;
};

/**
 * @method addObjectInFolder
 * @param parentObject {Object}
 * @param options {Object}
 * @param [options.nodeId=null] {NodeId} the object nodeid.
 * @param [options.browseName=""] {String} the object browse name.
 * @param [options.description=""] {String} the object description.
 * @param options.eventNotifier {Number} the event notifier flag.
 * @return {Object}
 */
AddressSpace.prototype.addObjectInFolder = function (parentObject, options) {

    var self = this;

    assert(options.hasOwnProperty("browseName") && options.browseName.length > 0);

    if (typeof parentObject === "string") {
        parentObject = self._coerceFolder(parentObject);
    }
    assert(parentObject && parentObject.nodeId); // should have a valid parent folder

    var nodeClass = options.nodeClass || NodeClass.Object;

    var baseObjectTypeId = self.findObject("BaseObjectType").nodeId;

    var newNodeId = options.nodeId || self._build_new_NodeId();

    var obj = self._createObject({
        nodeClass: nodeClass,
        isAbstract: false,
        nodeId: newNodeId,
        browseName: options.browseName,
        description: options.description || "",
        eventNotifier: options.eventNotifier,
        references: [
            {referenceType: "HasTypeDefinition", isForward: true, nodeId: baseObjectTypeId},
            {referenceType: "HasComponent", isForward: false, nodeId: parentObject.nodeId}
        ]
    });
    assert(obj.nodeId !== null);
    obj.propagate_back_references(self);
    return obj;
};



/**
 *
 * @method addFolder
 * @param parentFolder
 * @param options {String|Object}
 * @param options.browseName {String} the name of the folder
 * @param [options.nodeId] {NodeId}. An optional nodeId for this object
 *
 * @return {BaseNode}
 */
AddressSpace.prototype.addFolder = function (parentFolder, options) {

    var self = this;
    if (typeof options === "string") {
        options = {browseName: options};
    }

    assert(!options.hasTypeDefinition,"addFolder does not expect hasTypeDefinition to be defined ");
    var hasTypeDefinition = self._coerceTypeDefinition("FolderType");

    parentFolder = self._coerceFolder(parentFolder);

    options.nodeId = options.nodeId || self._build_new_NodeId();

    options.nodeClass = NodeClass.Object;

    options.references = [
        {referenceType: "HasTypeDefinition", isForward: true, nodeId: hasTypeDefinition },
        {referenceType: "Organizes", isForward: false, nodeId: parentFolder.nodeId}
    ];
    var object = self._createObject(options);
    object.propagate_back_references(self);
    assert(object.parent === parentFolder.nodeId);
    return object;
};

exports.AddressSpace = AddressSpace;
