var pas = { $libimports: {}};

var rtl = {

  version: 30200,

  quiet: false,
  debug_load_units: false,
  debug_rtti: false,

  $res : {},

  debug: function(){
    if (rtl.quiet || !console || !console.log) return;
    console.log(arguments);
  },

  error: function(s){
    rtl.debug('Error: ',s);
    throw s;
  },

  warn: function(s){
    rtl.debug('Warn: ',s);
  },

  checkVersion: function(v){
    if (rtl.version != v) throw "expected rtl version "+v+", but found "+rtl.version;
  },

  hiInt: Math.pow(2,53),

  hasString: function(s){
    return rtl.isString(s) && (s.length>0);
  },

  isArray: function(a) {
    return Array.isArray(a);
  },

  isFunction: function(f){
    return typeof(f)==="function";
  },

  isModule: function(m){
    return rtl.isObject(m) && rtl.hasString(m.$name) && (pas[m.$name]===m);
  },

  isImplementation: function(m){
    return rtl.isObject(m) && rtl.isModule(m.$module) && (m.$module.$impl===m);
  },

  isNumber: function(n){
    return typeof(n)==="number";
  },

  isObject: function(o){
    var s=typeof(o);
    return (typeof(o)==="object") && (o!=null);
  },

  isString: function(s){
    return typeof(s)==="string";
  },

  getNumber: function(n){
    return typeof(n)==="number"?n:NaN;
  },

  getChar: function(c){
    return ((typeof(c)==="string") && (c.length===1)) ? c : "";
  },

  getObject: function(o){
    return ((typeof(o)==="object") || (typeof(o)==='function')) ? o : null;
  },

  isTRecord: function(type){
    return (rtl.isObject(type) && type.hasOwnProperty('$new') && (typeof(type.$new)==='function'));
  },

  isPasClass: function(type){
    return (rtl.isObject(type) && type.hasOwnProperty('$classname') && rtl.isObject(type.$module));
  },

  isPasClassInstance: function(type){
    return (rtl.isObject(type) && rtl.isPasClass(type.$class));
  },

  hexStr: function(n,digits){
    return ("000000000000000"+n.toString(16).toUpperCase()).slice(-digits);
  },

  m_loading: 0,
  m_loading_intf: 1,
  m_intf_loaded: 2,
  m_loading_impl: 3, // loading all used unit
  m_initializing: 4, // running initialization
  m_initialized: 5,

  module: function(module_name, intfuseslist, intfcode, impluseslist){
    if (rtl.debug_load_units) rtl.debug('rtl.module name="'+module_name+'" intfuses='+intfuseslist+' impluses='+impluseslist);
    if (!rtl.hasString(module_name)) rtl.error('invalid module name "'+module_name+'"');
    if (!rtl.isArray(intfuseslist)) rtl.error('invalid interface useslist of "'+module_name+'"');
    if (!rtl.isFunction(intfcode)) rtl.error('invalid interface code of "'+module_name+'"');
    if (!(impluseslist==undefined) && !rtl.isArray(impluseslist)) rtl.error('invalid implementation useslist of "'+module_name+'"');

    if (pas[module_name])
      rtl.error('module "'+module_name+'" is already registered');

    var r = Object.create(rtl.tSectionRTTI);
    var module = r.$module = pas[module_name] = {
      $name: module_name,
      $intfuseslist: intfuseslist,
      $impluseslist: impluseslist,
      $state: rtl.m_loading,
      $intfcode: intfcode,
      $implcode: null,
      $impl: null,
      $rtti: r
    };
    if (impluseslist) module.$impl = {
          $module: module,
          $rtti: r
        };
  },

  exitcode: 0,

  run: function(module_name){
    try {
      if (!rtl.hasString(module_name)) module_name='program';
      if (rtl.debug_load_units) rtl.debug('rtl.run module="'+module_name+'"');
      rtl.initRTTI();
      var module = pas[module_name];
      if (!module) rtl.error('rtl.run module "'+module_name+'" missing');
      rtl.loadintf(module);
      rtl.loadimpl(module);
      if ((module_name=='program') || (module_name=='library')){
        if (rtl.debug_load_units) rtl.debug('running $main');
        var r = pas[module_name].$main();
        if (rtl.isNumber(r)) rtl.exitcode = r;
      }
    } catch(re) {
      if (!rtl.showUncaughtExceptions) {
        throw re
      } else {  
        if (!rtl.handleUncaughtException(re)) {
          rtl.showException(re);
          rtl.exitcode = 216;
        }  
      }
    } 
    return rtl.exitcode;
  },
  
  showException : function (re) {
    var errStack="";
    if (rtl.isObject(re) && re.hasOwnProperty('FJSError') && rtl.isObject(re.FJSError) && !(re.FJSError.stack==undefined)) // rtl Exception
      errStack=re.FJSError.stack
    else if (rtl.isObject(re) && re.hasOwnProperty('stack') && !(re.stack==undefined)) // native JS Error
      errStack=re.stack
    else
      errStack=re; // unknown object
    var errMsg = rtl.hasString(re.$classname) ? re.$classname : '';
    errMsg += ((errMsg) ? ': ' : '') + (re.hasOwnProperty('fMessage') ? re.fMessage : '');
    errMsg += ((errMsg) ? "\n" : '') + errStack;
    errMsg = "Uncaught Exception:\n" + errMsg;
    console.log(errMsg);
    alert(errMsg);
  },

  handleUncaughtException: function (e) {
    if (rtl.onUncaughtException) {
      try {
        rtl.onUncaughtException(e);
        return true;
      } catch (ee) {
        return false; 
      }
    } else {
      return false;
    }
  },

  loadintf: function(module){
    if (module.$state>rtl.m_loading_intf) return; // already finished
    if (rtl.debug_load_units) rtl.debug('loadintf: "'+module.$name+'"');
    if (module.$state===rtl.m_loading_intf)
      rtl.error('unit cycle detected "'+module.$name+'"');
    module.$state=rtl.m_loading_intf;
    // load interfaces of interface useslist
    rtl.loaduseslist(module,module.$intfuseslist,rtl.loadintf);
    // run interface
    if (rtl.debug_load_units) rtl.debug('loadintf: run intf of "'+module.$name+'"');
    module.$intfcode(module.$intfuseslist);
    // success
    module.$state=rtl.m_intf_loaded;
    // Note: units only used in implementations are not yet loaded (not even their interfaces)
  },

  loaduseslist: function(module,useslist,f){
    if (useslist==undefined) return;
    var len = useslist.length;
    for (var i = 0; i<len; i++) {
      var unitname=useslist[i];
      if (rtl.debug_load_units) rtl.debug('loaduseslist of "'+module.$name+'" uses="'+unitname+'"');
      if (pas[unitname]==undefined)
        rtl.error('module "'+module.$name+'" misses "'+unitname+'"');
      f(pas[unitname]);
    }
  },

  loadimpl: function(module){
    if (module.$state>=rtl.m_loading_impl) return; // already processing
    if (module.$state<rtl.m_intf_loaded) rtl.error('loadimpl: interface not loaded of "'+module.$name+'"');
    if (rtl.debug_load_units) rtl.debug('loadimpl: load uses of "'+module.$name+'"');
    module.$state=rtl.m_loading_impl;
    // load interfaces of implementation useslist
    rtl.loaduseslist(module,module.$impluseslist,rtl.loadintf);
    // load implementation of interfaces useslist
    rtl.loaduseslist(module,module.$intfuseslist,rtl.loadimpl);
    // load implementation of implementation useslist
    rtl.loaduseslist(module,module.$impluseslist,rtl.loadimpl);
    // Note: At this point all interfaces used by this unit are loaded. If
    //   there are implementation uses cycles some used units might not yet be
    //   initialized. This is by design.
    // run implementation
    if (rtl.debug_load_units) rtl.debug('loadimpl: run impl of "'+module.$name+'"');
    if (rtl.isFunction(module.$implcode)) module.$implcode(module.$impluseslist);
    // run initialization
    if (rtl.debug_load_units) rtl.debug('loadimpl: run init of "'+module.$name+'"');
    module.$state=rtl.m_initializing;
    if (rtl.isFunction(module.$init)) module.$init();
    // unit initialized
    module.$state=rtl.m_initialized;
  },

  createCallback: function(scope, fn){
    var cb;
    if (typeof(fn)==='string'){
      if (!scope.hasOwnProperty('$events')) scope.$events = {};
      cb = scope.$events[fn];
      if (cb) return cb;
      scope.$events[fn] = cb = function(){
        return scope[fn].apply(scope,arguments);
      };
    } else {
      cb = function(){
        return fn.apply(scope,arguments);
      };
    };
    cb.scope = scope;
    cb.fn = fn;
    return cb;
  },

  createSafeCallback: function(scope, fn){
    var cb;
    if (typeof(fn)==='string'){
      if (!scope[fn]) return null;
      if (!scope.hasOwnProperty('$events')) scope.$events = {};
      cb = scope.$events[fn];
      if (cb) return cb;
      scope.$events[fn] = cb = function(){
        try{
          return scope[fn].apply(scope,arguments);
        } catch (err) {
          if (!rtl.handleUncaughtException(err)) throw err;
        }
      };
    } else if(!fn) {
      return null;
    } else {
      cb = function(){
        try{
          return fn.apply(scope,arguments);
        } catch (err) {
          if (!rtl.handleUncaughtException(err)) throw err;
        }
      };
    };
    cb.scope = scope;
    cb.fn = fn;
    return cb;
  },

  eqCallback: function(a,b){
    // can be a function or a function wrapper
    if (a===b){
      return true;
    } else {
      return (a!=null) && (b!=null) && (a.fn) && (a.scope===b.scope) && (a.fn===b.fn);
    }
  },

  initStruct: function(c,parent,name){
    if ((parent.$module) && (parent.$module.$impl===parent)) parent=parent.$module;
    c.$parent = parent;
    if (rtl.isModule(parent)){
      c.$module = parent;
      c.$name = name;
    } else {
      c.$module = parent.$module;
      c.$name = parent.$name+'.'+name;
    };
    return parent;
  },

  initClass: function(c,parent,name,initfn,rttiname){
    parent[name] = c;
    c.$class = c; // Note: o.$class === Object.getPrototypeOf(o)
    c.$classname = rttiname?rttiname:name;
    parent = rtl.initStruct(c,parent,name);
    c.$fullname = parent.$name+'.'+name;
    // rtti
    if (rtl.debug_rtti) rtl.debug('initClass '+c.$fullname);
    var t = c.$module.$rtti.$Class(c.$classname,{ "class": c });
    c.$rtti = t;
    if (rtl.isObject(c.$ancestor)) t.ancestor = c.$ancestor.$rtti;
    if (!t.ancestor) t.ancestor = null;
    // init members
    initfn.call(c);
  },

  createClass: function(parent,name,ancestor,initfn,rttiname){
    // create a normal class,
    // ancestor must be null or a normal class,
    // the root ancestor can be an external class
    var c = null;
    if (ancestor != null){
      c = Object.create(ancestor);
      c.$ancestor = ancestor;
      // Note:
      // if root is an "object" then c.$ancestor === Object.getPrototypeOf(c)
      // if root is a "function" then c.$ancestor === c.__proto__, Object.getPrototypeOf(c) returns the root
    } else {
      c = { $ancestor: null };
      c.$create = function(fn,args){
        if (args == undefined) args = [];
        var o = Object.create(this);
        o.$init();
        try{
          if (typeof(fn)==="string"){
            o[fn].apply(o,args);
          } else {
            fn.apply(o,args);
          };
          o.AfterConstruction();
        } catch($e){
          // do not call BeforeDestruction
          if (o.Destroy) o.Destroy();
          o.$final();
          throw $e;
        }
        return o;
      };
      c.$destroy = function(fnname){
        this.BeforeDestruction();
        if (this[fnname]) this[fnname]();
        this.$final();
      };
    };
    rtl.initClass(c,parent,name,initfn,rttiname);
  },

  createClassExt: function(parent,name,ancestor,newinstancefnname,initfn,rttiname){
    // Create a class using an external ancestor.
    // If newinstancefnname is given, use that function to create the new object.
    // If exist call BeforeDestruction and AfterConstruction.
    var isFunc = rtl.isFunction(ancestor);
    var c = null;
    if (isFunc){
      // create pascal class descendent from JS function
      c = Object.create(ancestor.prototype);
      c.$ancestorfunc = ancestor;
      c.$ancestor = null; // no pascal ancestor
    } else if (ancestor.$func){
      // create pascal class descendent from a pascal class descendent of a JS function
      isFunc = true;
      c = Object.create(ancestor);
      c.$ancestor = ancestor;
    } else {
      c = Object.create(ancestor);
      c.$ancestor = null; // no pascal ancestor
    }
    c.$create = function(fn,args){
      if (args == undefined) args = [];
      var o = null;
      if (newinstancefnname.length>0){
        o = this[newinstancefnname](fn,args);
      } else if(isFunc) {
        o = new this.$func(args);
      } else {
        o = Object.create(c);
      }
      if (o.$init) o.$init();
      try{
        if (typeof(fn)==="string"){
          this[fn].apply(o,args);
        } else {
          fn.apply(o,args);
        };
        if (o.AfterConstruction) o.AfterConstruction();
      } catch($e){
        // do not call BeforeDestruction
        if (o.Destroy) o.Destroy();
        if (o.$final) o.$final();
        throw $e;
      }
      return o;
    };
    c.$destroy = function(fnname){
      if (this.BeforeDestruction) this.BeforeDestruction();
      if (this[fnname]) this[fnname]();
      if (this.$final) this.$final();
    };
    rtl.initClass(c,parent,name,initfn,rttiname);
    if (isFunc){
      function f(){}
      f.prototype = c;
      c.$func = f;
    }
  },

  createHelper: function(parent,name,ancestor,initfn,rttiname){
    // create a helper,
    // ancestor must be null or a helper,
    var c = null;
    if (ancestor != null){
      c = Object.create(ancestor);
      c.$ancestor = ancestor;
      // c.$ancestor === Object.getPrototypeOf(c)
    } else {
      c = { $ancestor: null };
    };
    parent[name] = c;
    c.$class = c; // Note: o.$class === Object.getPrototypeOf(o)
    c.$classname = rttiname?rttiname:name;
    parent = rtl.initStruct(c,parent,name);
    c.$fullname = parent.$name+'.'+name;
    // rtti
    var t = c.$module.$rtti.$Helper(c.$classname,{ "helper": c });
    c.$rtti = t;
    if (rtl.isObject(ancestor)) t.ancestor = ancestor.$rtti;
    if (!t.ancestor) t.ancestor = null;
    // init members
    initfn.call(c);
  },

  tObjectDestroy: "Destroy",

  free: function(obj,name){
    if (obj[name]==null) return null;
    obj[name].$destroy(rtl.tObjectDestroy);
    obj[name]=null;
  },

  freeLoc: function(obj){
    if (obj==null) return null;
    obj.$destroy(rtl.tObjectDestroy);
    return null;
  },

  hideProp: function(o,p,v){
    Object.defineProperty(o,p, {
      enumerable: false,
      configurable: true,
      writable: true
    });
    if(arguments.length>2){ o[p]=v; }
  },

  recNewT: function(parent,name,initfn,full){
    // create new record type
    var t = {};
    if (parent) parent[name] = t;
    var h = rtl.hideProp;
    if (full){
      rtl.initStruct(t,parent,name);
      t.$record = t;
      h(t,'$record');
      h(t,'$name');
      h(t,'$parent');
      h(t,'$module');
      h(t,'$initSpec');
    }
    initfn.call(t);
    if (!t.$new){
      t.$new = function(){ return Object.create(t); };
    }
    t.$clone = function(r){ return t.$new().$assign(r); };
    h(t,'$new');
    h(t,'$clone');
    h(t,'$eq');
    h(t,'$assign');
    return t;
  },

  is: function(instance,type){
    return type.isPrototypeOf(instance) || (instance===type);
  },

  isExt: function(instance,type,mode){
    // mode===1 means instance must be a Pascal class instance
    // mode===2 means instance must be a Pascal class
    // Notes:
    // isPrototypeOf and instanceof return false on equal
    // isPrototypeOf does not work for Date.isPrototypeOf(new Date())
    //   so if isPrototypeOf is false test with instanceof
    // instanceof needs a function on right side
    if (instance == null) return false; // Note: ==null checks for undefined too
    if ((typeof(type) !== 'object') && (typeof(type) !== 'function')) return false;
    if (instance === type){
      if (mode===1) return false;
      if (mode===2) return rtl.isPasClass(instance);
      return true;
    }
    if (type.isPrototypeOf && type.isPrototypeOf(instance)){
      if (mode===1) return rtl.isPasClassInstance(instance);
      if (mode===2) return rtl.isPasClass(instance);
      return true;
    }
    if ((typeof type == 'function') && (instance instanceof type)) return true;
    return false;
  },

  Exception: null,
  EInvalidCast: null,
  EAbstractError: null,
  ERangeError: null,
  EIntOverflow: null,
  EPropWriteOnly: null,

  raiseE: function(typename){
    var t = rtl[typename];
    if (t==null){
      var mod = pas.SysUtils;
      if (!mod) mod = pas.sysutils;
      if (!mod) mod = pas["System.SysUtils"];
      if (mod){
        t = mod[typename];
        if (!t) t = mod[typename.toLowerCase()];
        if (!t) t = mod['Exception'];
        if (!t) t = mod['exception'];
      }
      if (t) rtl[typename]=t;
    }
    if (t) {
      
      if (t.Create){
        var e = t.$create("Create");
      } else if (t.create) {
        var e = t.$create("create");
      }
      if (e) {
        e.FJSError = new Error;
        throw e ;
      }
    }
    if (typename === "EInvalidCast") throw new Error("invalid type cast");
    if (typename === "EAbstractError") throw new Error("Abstract method called");
    if (typename === "ERangeError") throw new Error("range error");
    throw typename;
  },

  as: function(instance,type){
    if((instance === null) || rtl.is(instance,type)) return instance;
    rtl.raiseE("EInvalidCast");
  },

  asExt: function(instance,type,mode){
    if((instance === null) || rtl.isExt(instance,type,mode)) return instance;
    rtl.raiseE("EInvalidCast");
  },

  createInterface: function(module, name, guid, fnnames, ancestor, initfn, rttiname){
    //console.log('createInterface name="'+name+'" guid="'+guid+'" names='+fnnames);
    var i = ancestor?Object.create(ancestor):{};
    module[name] = i;
    i.$module = module;
    i.$name = rttiname?rttiname:name;
    i.$fullname = module.$name+'.'+i.$name;
    i.$guid = guid;
    i.$guidr = null;
    i.$names = fnnames?fnnames:[];
    if (rtl.isFunction(initfn)){
      // rtti
      if (rtl.debug_rtti) rtl.debug('createInterface '+i.$fullname);
      var t = i.$module.$rtti.$Interface(i.$name,{ "interface": i, module: module });
      i.$rtti = t;
      if (ancestor) t.ancestor = ancestor.$rtti;
      if (!t.ancestor) t.ancestor = null;
      initfn.call(i);
    }
    return i;
  },

  strToGUIDR: function(s,g){
    var p = 0;
    function n(l){
      var h = s.substr(p,l);
      p+=l;
      return parseInt(h,16);
    }
    p+=1; // skip {
    g.D1 = n(8);
    p+=1; // skip -
    g.D2 = n(4);
    p+=1; // skip -
    g.D3 = n(4);
    p+=1; // skip -
    if (!g.D4) g.D4=[];
    g.D4[0] = n(2);
    g.D4[1] = n(2);
    p+=1; // skip -
    for(var i=2; i<8; i++) g.D4[i] = n(2);
    return g;
  },

  guidrToStr: function(g){
    if (g.$intf) return g.$intf.$guid;
    var h = rtl.hexStr;
    var s='{'+h(g.D1,8)+'-'+h(g.D2,4)+'-'+h(g.D3,4)+'-'+h(g.D4[0],2)+h(g.D4[1],2)+'-';
    for (var i=2; i<8; i++) s+=h(g.D4[i],2);
    s+='}';
    return s;
  },

  createTGUID: function(guid){
    var TGuid = (pas.System)?pas.System.TGuid:pas.system.tguid;
    var g = rtl.strToGUIDR(guid,TGuid.$new());
    return g;
  },

  getIntfGUIDR: function(intfTypeOrVar){
    if (!intfTypeOrVar) return null;
    if (!intfTypeOrVar.$guidr){
      var g = rtl.createTGUID(intfTypeOrVar.$guid);
      if (!intfTypeOrVar.hasOwnProperty('$guid')) intfTypeOrVar = Object.getPrototypeOf(intfTypeOrVar);
      g.$intf = intfTypeOrVar;
      intfTypeOrVar.$guidr = g;
    }
    return intfTypeOrVar.$guidr;
  },

  addIntf: function (aclass, intf, map){
    function jmp(fn){
      if (typeof(fn)==="function"){
        return function(){ return fn.apply(this.$o,arguments); };
      } else {
        return function(){ rtl.raiseE('EAbstractError'); };
      }
    }
    if(!map) map = {};
    var t = intf;
    var item = Object.create(t);
    if (!aclass.hasOwnProperty('$intfmaps')) aclass.$intfmaps = {};
    aclass.$intfmaps[intf.$guid] = item;
    do{
      var names = t.$names;
      if (!names) break;
      for (var i=0; i<names.length; i++){
        var intfname = names[i];
        var fnname = map[intfname];
        if (!fnname) fnname = intfname;
        //console.log('addIntf: intftype='+t.$name+' index='+i+' intfname="'+intfname+'" fnname="'+fnname+'" old='+typeof(item[intfname]));
        item[intfname] = jmp(aclass[fnname]);
      }
      t = Object.getPrototypeOf(t);
    }while(t!=null);
  },

  getIntfG: function (obj, guid, query){
    if (!obj) return null;
    //console.log('getIntfG: obj='+obj.$classname+' guid='+guid+' query='+query);
    // search
    var maps = obj.$intfmaps;
    if (!maps) return null;
    var item = maps[guid];
    if (!item) return null;
    // check delegation
    //console.log('getIntfG: obj='+obj.$classname+' guid='+guid+' query='+query+' item='+typeof(item));
    if (typeof item === 'function') return item.call(obj); // delegate. Note: COM contains _AddRef
    // check cache
    var intf = null;
    if (obj.$interfaces){
      intf = obj.$interfaces[guid];
      //console.log('getIntfG: obj='+obj.$classname+' guid='+guid+' cache='+typeof(intf));
    }
    if (!intf){ // intf can be undefined!
      intf = Object.create(item);
      intf.$o = obj;
      if (!obj.$interfaces) obj.$interfaces = {};
      obj.$interfaces[guid] = intf;
    }
    if (typeof(query)==='object'){
      // called by queryIntfT
      var o = null;
      if (intf.QueryInterface(rtl.getIntfGUIDR(query),
          {get:function(){ return o; }, set:function(v){ o=v; }}) === 0){
        return o;
      } else {
        return null;
      }
    } else if(query===2){
      // called by TObject.GetInterfaceByStr
      if (intf.$kind === 'com') intf._AddRef();
    }
    return intf;
  },

  getIntfT: function(obj,intftype){
    return rtl.getIntfG(obj,intftype.$guid);
  },

  queryIntfT: function(obj,intftype){
    return rtl.getIntfG(obj,intftype.$guid,intftype);
  },

  queryIntfIsT: function(obj,intftype){
    var i = rtl.getIntfG(obj,intftype.$guid);
    if (!i) return false;
    if (i.$kind === 'com') i._Release();
    return true;
  },

  asIntfT: function (obj,intftype){
    var i = rtl.getIntfG(obj,intftype.$guid);
    if (i!==null) return i;
    rtl.raiseEInvalidCast();
  },

  intfIsIntfT: function(intf,intftype){
    return (intf!==null) && rtl.queryIntfIsT(intf.$o,intftype);
  },

  intfAsIntfT: function (intf,intftype){
    if (!intf) return null;
    var i = rtl.getIntfG(intf.$o,intftype.$guid);
    if (i) return i;
    rtl.raiseEInvalidCast();
  },

  intfIsClass: function(intf,classtype){
    return (intf!=null) && (rtl.is(intf.$o,classtype));
  },

  intfAsClass: function(intf,classtype){
    if (intf==null) return null;
    return rtl.as(intf.$o,classtype);
  },

  intfToClass: function(intf,classtype){
    if ((intf!==null) && rtl.is(intf.$o,classtype)) return intf.$o;
    return null;
  },

  // interface reference counting
  intfRefs: { // base object for temporary interface variables
    ref: function(id,intf){
      // called for temporary interface references needing delayed release
      var old = this[id];
      //console.log('rtl.intfRefs.ref: id='+id+' old="'+(old?old.$name:'null')+'" intf="'+(intf?intf.$name:'null')+' $o='+(intf?intf.$o:'null'));
      if (old){
        // called again, e.g. in a loop
        delete this[id];
        old._Release(); // may fail
      }
      if(intf) {
        this[id]=intf;
      }
      return intf;
    },
    free: function(){
      //console.log('rtl.intfRefs.free...');
      for (var id in this){
        if (this.hasOwnProperty(id)){
          var intf = this[id];
          if (intf){
            //console.log('rtl.intfRefs.free: id='+id+' '+intf.$name+' $o='+intf.$o.$classname);
            intf._Release();
          }
        }
      }
    }
  },

  createIntfRefs: function(){
    //console.log('rtl.createIntfRefs');
    return Object.create(rtl.intfRefs);
  },

  setIntfP: function(path,name,value,skipAddRef){
    var old = path[name];
    //console.log('rtl.setIntfP path='+path+' name='+name+' old="'+(old?old.$name:'null')+'" value="'+(value?value.$name:'null')+'"');
    if (old === value) return;
    if (old !== null){
      path[name]=null;
      old._Release();
    }
    if (value !== null){
      if (!skipAddRef) value._AddRef();
      path[name]=value;
    }
  },

  setIntfL: function(old,value,skipAddRef){
    //console.log('rtl.setIntfL old="'+(old?old.$name:'null')+'" value="'+(value?value.$name:'null')+'"');
    if (old !== value){
      if (value!==null){
        if (!skipAddRef) value._AddRef();
      }
      if (old!==null){
        old._Release();  // Release after AddRef, to avoid double Release if Release creates an exception
      }
    } else if (skipAddRef){
      if (old!==null){
        old._Release();  // value has an AddRef
      }
    }
    return value;
  },

  _AddRef: function(intf){
    //if (intf) console.log('rtl._AddRef intf="'+(intf?intf.$name:'null')+'"');
    if (intf) intf._AddRef();
    return intf;
  },

  _Release: function(intf){
    //if (intf) console.log('rtl._Release intf="'+(intf?intf.$name:'null')+'"');
    if (intf) intf._Release();
    return intf;
  },

  trunc: function(a){
    return a<0 ? Math.ceil(a) : Math.floor(a);
  },

  checkMethodCall: function(obj,type){
    if (rtl.isObject(obj) && rtl.is(obj,type)) return;
    rtl.raiseE("EInvalidCast");
  },

  oc: function(i){
    // overflow check integer
    if ((Math.floor(i)===i) && (i>=-0x1fffffffffffff) && (i<=0x1fffffffffffff)) return i;
    rtl.raiseE('EIntOverflow');
  },

  rc: function(i,minval,maxval){
    // range check integer
    if ((Math.floor(i)===i) && (i>=minval) && (i<=maxval)) return i;
    rtl.raiseE('ERangeError');
  },

  rcc: function(c,minval,maxval){
    // range check char
    if ((typeof(c)==='string') && (c.length===1)){
      var i = c.charCodeAt(0);
      if ((i>=minval) && (i<=maxval)) return c;
    }
    rtl.raiseE('ERangeError');
  },

  rcSetCharAt: function(s,index,c){
    // range check setCharAt
    if ((typeof(s)!=='string') || (index<0) || (index>=s.length)) rtl.raiseE('ERangeError');
    return rtl.setCharAt(s,index,c);
  },

  rcCharAt: function(s,index){
    // range check charAt
    if ((typeof(s)!=='string') || (index<0) || (index>=s.length)) rtl.raiseE('ERangeError');
    return s.charAt(index);
  },

  rcArrR: function(arr,index){
    // range check read array
    if (Array.isArray(arr) && (typeof(index)==='number') && (index>=0) && (index<arr.length)){
      if (arguments.length>2){
        // arr,index1,index2,...
        arr=arr[index];
        for (var i=2; i<arguments.length; i++) arr=rtl.rcArrR(arr,arguments[i]);
        return arr;
      }
      return arr[index];
    }
    rtl.raiseE('ERangeError');
  },

  rcArrW: function(arr,index,value){
    // range check write array
    // arr,index1,index2,...,value
    for (var i=3; i<arguments.length; i++){
      arr=rtl.rcArrR(arr,index);
      index=arguments[i-1];
      value=arguments[i];
    }
    if (Array.isArray(arr) && (typeof(index)==='number') && (index>=0) && (index<arr.length)){
      return arr[index]=value;
    }
    rtl.raiseE('ERangeError');
  },

  length: function(arr){
    return (arr == null) ? 0 : arr.length;
  },

  arrayRef: function(a){
    if (a!=null) rtl.hideProp(a,'$pas2jsrefcnt',2);
    return a;
  },

  arrayManaged: function(refCnt,mode,a){
    // mode: 0: don't touch elements, 1: null elements, 2: _AddRef elements
    if(!a) a = [];
    a.$pas2jsrefcnt = refCnt?refCnt:0;
    a._AddRef = function(){
      this.$pas2jsrefcnt++;
    };
    a._Release = function(){
      this.$pas2jsrefcnt--;
      if (this.$pas2jsrefcnt==0){
        for (var i=0; i<this.length; i++){
          rtl.setIntfP(this,i,null);
        }
      }
    };
    if (mode>0){
      for (var i=0; i<a.length; i++){
        if (mode === 2){
          rtl._AddRef(a[i]);
        } else {
          a[i]=null;
        }
      }
    }
    return a;
  },

  arraySetLength: function(arr,defaultvalue,newlength){
    var stack = [];
    var s = 9999;
    for (var i=2; i<arguments.length; i++){
      var j = arguments[i];
      if (j==='s'){ s = i-2; }
      else {
        stack.push({ dim:j+0, a:null, i:0, src:null });
      }
    }
    var dimmax = stack.length-1;
    var depth = 0;
    var newlen = 0;
    var item = null;
    var a = null;
    var src = arr;
    var srclen = 0, oldlen = 0;
    var type = 0;
    var managed = false;
    if (rtl.isArray(defaultvalue)){
      // array of dyn array
      type = 1;
    } else if (rtl.isObject(defaultvalue)) {
      if (rtl.isTRecord(defaultvalue)){
        // array of record
        type = 2;
      } else {
        // array of set
        type = 3;
      }
    } else if (defaultvalue == 'R'){
      // array of COM interface
      type = 4;
      managed = true;
    }

    do{
      if (depth>0){
        item = stack[depth-1];
        src = (item.src && item.src.length>item.i) ? item.src[item.i] : null;
      }
      if (!src){
        // init array
        managed ? a=rtl.arrayManaged(1) : a=[];
        srclen = 0;
        oldlen = 0;
      } else if (src.$pas2jsrefcnt>1 || depth>=s){
        // clone
        if (managed){
          a = rtl.arrayManaged(1);
          src.$pas2jsrefcnt--;
        } else {
          a = [];
        }
        srclen = src.length;
        oldlen = srclen;
      } else {
        // keep old
        a = src;
        srclen = 0;
        oldlen = a.length;
      }
      newlen = stack[depth].dim;
      if (managed){
        if (a.length>=newlen){
          // shrink -> release elements
          for (var i=a.length-1; i>=newlen; i--){
            rtl.setIntfP(a,i,null);
          }
          a.length = newlen;
        } else {
          // enlarge -> null elements
          var l = a.length;
          a.length = newlen;
          for (var i=l; i<newlen; i++){
            a[i]=null;
          }
          oldlen = newlen;
        }
      } else {
        a.length = newlen;
      }
      if (depth>0){
        item.a[item.i]=a;
        item.i++;
        if ((newlen===0) && (item.i<item.a.length)) continue;
      }
      if (newlen>0){
        if (depth<dimmax){
          item = stack[depth];
          item.a = a;
          item.i = 0;
          item.src = src;
          depth++;
          continue;
        } else {
          if (srclen>newlen) srclen=newlen;
          if (type == 0){
            // array of simple value
            for (var i=0; i<srclen; i++) a[i]=src[i];
            for (var i=oldlen; i<newlen; i++) a[i]=defaultvalue;
          } else if (type == 1){
            // array of dyn array
            for (var i=0; i<srclen; i++) a[i]=src[i];
            for (var i=oldlen; i<newlen; i++) a[i]=[];
          } else if (type == 2) {
            // array of record
            for (var i=0; i<srclen; i++) a[i]=defaultvalue.$clone(src[i]);
            for (var i=oldlen; i<newlen; i++) a[i]=defaultvalue.$new();
          } else if (type == 3) {
            // array of set
            for (var i=0; i<srclen; i++) a[i]=rtl.refSet(src[i]);
            for (var i=oldlen; i<newlen; i++) a[i]={};
          } else if (type == 4){
            // array of interface
            for (var i=0; i<srclen; i++) rtl.setIntfP(a,i,src[i]);
            for (var i=oldlen; i<newlen; i++) a[i]=null;
          }
        }
      }
      // backtrack
      while ((depth>0) && (stack[depth-1].i>=stack[depth-1].dim)){
        depth--;
      };
      if (depth===0){
        return dimmax===0 ? a : stack[0].a;
      }
    }while (true);
  },

  arrayEq: function(a,b){
    if (a===null) return b===null;
    if (b===null) return false;
    if (a.length!==b.length) return false;
    for (var i=0; i<a.length; i++) if (a[i]!==b[i]) return false;
    return true;
  },

  arrayClone: function(type,src,srcpos,endpos,dst,dstpos){
    // type: 0 for references or simple values
    // src must not be null
    // dst at dstpos must not contain managed old values
    // This function does not range check.
    if(type === 'refSet') {
      for (; srcpos<endpos; srcpos++) dst[dstpos++] = rtl.refSet(src[srcpos]); // ref set
    } else if (type === 'slice'){
      for (; srcpos<endpos; srcpos++) dst[dstpos++] = src[srcpos].slice(0); // clone static array of simple types
    } else if (typeof(type)==='function'){
      for (; srcpos<endpos; srcpos++) dst[dstpos++] = type(src[srcpos]); // clone function
    } else if (rtl.isTRecord(type)){
      for (; srcpos<endpos; srcpos++) dst[dstpos++] = type.$clone(src[srcpos]); // clone record
    } else if (type === 'R'){
      // clone managed instance
      for (; srcpos<endpos; srcpos++){
        dst[dstpos++]=rtl._AddRef(src[srcpos]);
      }
    } else {
      for (; srcpos<endpos; srcpos++) dst[dstpos++] = src[srcpos]; // reference
    };
  },

  arrayConcat: function(type){
    // type: see rtl.arrayClone
    // returns refCnt=1
    var a = [];
    var l = 0;
    for (var i=1; i<arguments.length; i++){
      var src = arguments[i];
      if (src !== null) l+=src.length;
    };
    a.length = l;
    if (type === 'R'){
      rtl.arrayManaged(1,1,a);
    }
    l=0;
    for (var i=1; i<arguments.length; i++){
      var src = arguments[i];
      if (src === null) continue;
      rtl.arrayClone(type,src,0,src.length,a,l);
      l+=src.length;
    };
    return a;
  },

  arrayConcatN: function(){
    var a = null;
    for (var i=0; i<arguments.length; i++){
      var src = arguments[i];
      if (src === null) continue;
      if (a===null){
        a=rtl.arrayRef(src); // Note: concat(arr) does not clone
      } else if (a.$pas2jsrefcnt>1){
        a=a.concat(src); // clone a and append src
      } else {
        for (var i=0; i<src.length; i++){
          a.push(src[i]);
        }
      }
    };
    return a;
  },

  arrayPush: function(type,a){
    if(a===null){
      a=(type==='R') ? rtl.arrayManaged(1) : [];
    } else if (a.$pas2jsrefcnt>1){
      a=rtl.arrayCopy(type,a,0,a.length);
    }
    rtl.arrayClone(type,arguments,2,arguments.length,a,a.length);
    return a;
  },

  arrayPushN: function(a){
    if(a===null){
      a=[];
    } else if (a.$pas2jsrefcnt>1){
      a=a.concat();
    }
    for (var i=1; i<arguments.length; i++){
      a.push(arguments[i]);
    }
    return a;
  },

  arrayCopy: function(type, srcarray, index, count){
    // type: see rtl.arrayClone
    // if count is missing, use srcarray.length
    if (srcarray === null) return (type === 'R') ? null : [];
    if (count === undefined) count=srcarray.length;
    if (index < 0){
      count+=index;
      index = 0;
    }
    var end = index+count;
    if (end>srcarray.length) end = srcarray.length;
    if (index>=end) return (type === 'R') ? null : [];
    if (type===0){
      return srcarray.slice(index,end);
    } else {
      var a = [];
      a.length = end-index;
      if (type === 'R'){
        rtl.arrayManaged(1,1,a);
      }
      rtl.arrayClone(type,srcarray,index,end,a,0);
      return a;
    }
  },

  arrayInsert: function(item, a, index, type){
    var m = (type === 'R');
    if (m) rtl._AddRef(item);
    if (a){
      if (a.$pas2jsrefcnt>1){
        if (m){
          // clone
          a.$pas2jsrefcnt--;
          a=rtl.arrayManaged(1,2,a.concat());
        } else {
          a=a.concat();
        }
      }
      a.splice(index,0,item);
      return a;
    } else {
      a = [item];
      if (m) a=rtl.arrayManaged(1,0,a);
      return a;
    }
  },

  arrayDeleteR: function(a, index, count){
    if (a===null || index<0 || index>=a.length || count<=0) return a;
    if (index+count>a.length) count=a.length-index;
    if (a.$pas2jsrefcnt>1){
      // clone
      a.$pas2jsrefcnt--;
      a=rtl.arrayManaged(1,2,a.concat());
    }
    for (var i=0; i<count; i++) rtl.setIntfP(a,index+i,null);
    a.splice(index,count);
    return a;
  },

  setCharAt: function(s,index,c){
    return s.substr(0,index)+c+s.substr(index+1);
  },

  getResStr: function(mod,name){
    var rs = mod.$resourcestrings[name];
    return rs.current?rs.current:rs.org;
  },

  createSet: function(){
    var s = {};
    for (var i=0; i<arguments.length; i++){
      if (arguments[i]!=null){
        s[arguments[i]]=true;
      } else {
        var first=arguments[i+=1];
        var last=arguments[i+=1];
        for(var j=first; j<=last; j++) s[j]=true;
      }
    }
    return s;
  },

  cloneSet: function(s){
    var r = {};
    for (var key in s) r[key]=true;
    return r;
  },

  refSet: function(s){
    rtl.hideProp(s,'$shared',true);
    return s;
  },

  includeSet: function(s,enumvalue){
    if (s.$shared) s = rtl.cloneSet(s);
    s[enumvalue] = true;
    return s;
  },

  excludeSet: function(s,enumvalue){
    if (s.$shared) s = rtl.cloneSet(s);
    delete s[enumvalue];
    return s;
  },

  diffSet: function(s,t){
    var r = {};
    for (var key in s) if (!t[key]) r[key]=true;
    return r;
  },

  unionSet: function(s,t){
    var r = {};
    for (var key in s) r[key]=true;
    for (var key in t) r[key]=true;
    return r;
  },

  intersectSet: function(s,t){
    var r = {};
    for (var key in s) if (t[key]) r[key]=true;
    return r;
  },

  symDiffSet: function(s,t){
    var r = {};
    for (var key in s) if (!t[key]) r[key]=true;
    for (var key in t) if (!s[key]) r[key]=true;
    return r;
  },

  eqSet: function(s,t){
    for (var key in s) if (!t[key]) return false;
    for (var key in t) if (!s[key]) return false;
    return true;
  },

  neSet: function(s,t){
    return !rtl.eqSet(s,t);
  },

  leSet: function(s,t){
    for (var key in s) if (!t[key]) return false;
    return true;
  },

  geSet: function(s,t){
    for (var key in t) if (!s[key]) return false;
    return true;
  },

  strSetLength: function(s,newlen){
    var oldlen = s.length;
    if (oldlen > newlen){
      return s.substring(0,newlen);
    } else if (s.repeat){
      // Note: repeat needs ECMAScript6!
      return s+' '.repeat(newlen-oldlen);
    } else {
       while (oldlen<newlen){
         s+=' ';
         oldlen++;
       };
       return s;
    }
  },

  spaceLeft: function(s,width){
    var l=s.length;
    if (l>=width) return s;
    if (s.repeat){
      // Note: repeat needs ECMAScript6!
      return ' '.repeat(width-l) + s;
    } else {
      while (l<width){
        s=' '+s;
        l++;
      };
      return s;
    };
  },

  floatToStr: function(d,w,p){
    // input 1-3 arguments: double, width, precision
    if (arguments.length>2){
      return rtl.spaceLeft(d.toFixed(p),w);
    } else {
	  // exponent width
	  var pad = "";
	  var ad = Math.abs(d);
	  if (((ad>1) && (ad<1.0e+10)) ||  ((ad>1.e-10) && (ad<1))) {
		pad='00';
	  } else if ((ad>1) && (ad<1.0e+100) || (ad<1.e-10)) {
		pad='0';
      }  	
	  if (arguments.length<2) {
	    w=24;		
      } else if (w<9) {
		w=9;
      }		  
      var p = w-8;
      var s=(d>0 ? " " : "" ) + d.toExponential(p);
      s=s.replace(/e(.)/,'E$1'+pad);
      return rtl.spaceLeft(s,w);
    }
  },

  valEnum: function(s, enumType, setCodeFn){
    s = s.toLowerCase();
    for (var key in enumType){
      if((typeof(key)==='string') && (key.toLowerCase()===s)){
        setCodeFn(0);
        return enumType[key];
      }
    }
    setCodeFn(1);
    return 0;
  },

  lw: function(l){
    // fix longword bitwise operation
    return l<0?l+0x100000000:l;
  },

  and: function(a,b){
    var hi = 0x80000000;
    var low = 0x7fffffff;
    var h = (a / hi) & (b / hi);
    var l = (a & low) & (b & low);
    return h*hi + l;
  },

  or: function(a,b){
    var hi = 0x80000000;
    var low = 0x7fffffff;
    var h = (a / hi) | (b / hi);
    var l = (a & low) | (b & low);
    return h*hi + l;
  },

  xor: function(a,b){
    var hi = 0x80000000;
    var low = 0x7fffffff;
    var h = (a / hi) ^ (b / hi);
    var l = (a & low) ^ (b & low);
    return h*hi + l;
  },

  shr: function(a,b){
    if (a<0) a += rtl.hiInt;
    if (a<0x80000000) return a >> b;
    if (b<=0) return a;
    if (b>54) return 0;
    return Math.floor(a / Math.pow(2,b));
  },

  shl: function(a,b){
    if (a<0) a += rtl.hiInt;
    if (b<=0) return a;
    if (b>54) return 0;
    var r = a * Math.pow(2,b);
    if (r <= rtl.hiInt) return r;
    return r % rtl.hiInt;
  },

  initRTTI: function(){
    if (rtl.debug_rtti) rtl.debug('initRTTI');

    // base types
    rtl.tTypeInfo = { name: "tTypeInfo", kind: 0, $module: null, attr: null };
    function newBaseTI(name,kind,ancestor){
      if (!ancestor) ancestor = rtl.tTypeInfo;
      if (rtl.debug_rtti) rtl.debug('initRTTI.newBaseTI "'+name+'" '+kind+' ("'+ancestor.name+'")');
      var t = Object.create(ancestor);
      t.name = name;
      t.kind = kind;
      rtl[name] = t;
      return t;
    };
    function newBaseInt(name,minvalue,maxvalue,ordtype){
      var t = newBaseTI(name,1 /* tkInteger */,rtl.tTypeInfoInteger);
      t.minvalue = minvalue;
      t.maxvalue = maxvalue;
      t.ordtype = ordtype;
      return t;
    };
    newBaseTI("tTypeInfoInteger",1 /* tkInteger */);
    newBaseInt("shortint",-0x80,0x7f,0);
    newBaseInt("byte",0,0xff,1);
    newBaseInt("smallint",-0x8000,0x7fff,2);
    newBaseInt("word",0,0xffff,3);
    newBaseInt("longint",-0x80000000,0x7fffffff,4);
    newBaseInt("longword",0,0xffffffff,5);
    newBaseInt("nativeint",-0x10000000000000,0xfffffffffffff,6);
    newBaseInt("nativeuint",0,0xfffffffffffff,7);
    newBaseInt("char",0,65535,3 /* word */).kind=2 /* tkChar */;
    newBaseTI("string",3 /* tkString */);
    newBaseTI("tTypeInfoEnum",4 /* tkEnumeration */,rtl.tTypeInfoInteger);
    newBaseTI("tTypeInfoSet",5 /* tkSet */);
    newBaseTI("double",6 /* tkDouble */);
    newBaseTI("boolean",7 /* tkBool */);
    newBaseTI("tTypeInfoProcVar",8 /* tkProcVar */);
    newBaseTI("tTypeInfoMethodVar",9 /* tkMethod */,rtl.tTypeInfoProcVar);
    newBaseTI("tTypeInfoArray",10 /* tkArray */);
    newBaseTI("tTypeInfoDynArray",11 /* tkDynArray */);
    newBaseTI("tTypeInfoPointer",15 /* tkPointer */);
    var t = newBaseTI("pointer",15 /* tkPointer */,rtl.tTypeInfoPointer);
    t.reftype = null;
    newBaseTI("jsvalue",16 /* tkJSValue */);
    newBaseTI("tTypeInfoRefToProcVar",17 /* tkRefToProcVar */,rtl.tTypeInfoProcVar);

    // member kinds
    rtl.tTypeMember = { attr: null };
    function newMember(name,kind){
      var m = Object.create(rtl.tTypeMember);
      m.name = name;
      m.kind = kind;
      rtl[name] = m;
    };
    newMember("tTypeMemberField",1); // tmkField
    newMember("tTypeMemberMethod",2); // tmkMethod
    newMember("tTypeMemberProperty",3); // tmkProperty

    // base object for storing members: a simple object
    rtl.tTypeMembers = {};

    // tTypeInfoStruct - base object for tTypeInfoClass, tTypeInfoRecord, tTypeInfoInterface
    var tis = newBaseTI("tTypeInfoStruct",0);
    tis.$addMember = function(name,ancestor,vis,options){
      if (rtl.debug_rtti){
        if (!rtl.hasString(name) || (name.charAt()==='$')) throw 'invalid member "'+name+'", this="'+this.name+'"';
        if (!rtl.is(ancestor,rtl.tTypeMember)) throw 'invalid ancestor "'+ancestor+':'+ancestor.name+'", "'+this.name+'.'+name+'"';
        if ((options!=undefined) && (typeof(options)!='object')) throw 'invalid options "'+options+'", "'+this.name+'.'+name+'"';
      };
      var t = Object.create(ancestor);
      t.name = name;
      this.members[name] = t;
      this.names.push(name);
      t.visibility = vis;
      if (rtl.isObject(options)){
        for (var key in options) if (options.hasOwnProperty(key)) t[key] = options[key];
      };
      return t;
    };
    tis.addField = function(name,type,vis,options){
      var t = this.$addMember(name,rtl.tTypeMemberField,vis?vis:2,options);
      if (rtl.debug_rtti){
        if (!rtl.is(type,rtl.tTypeInfo)) throw 'invalid type "'+type+'", "'+this.name+'.'+name+'"';
      };
      t.typeinfo = type;
      this.fields.push(name);
      return t;
    };
    tis.addFields = function(){
      var i=0;
      while(i<arguments.length){
        var name = arguments[i++];
        var type = arguments[i++];
        if ((i<arguments.length) && (typeof(arguments[i])==='object')){
          this.addField(name,type,arguments[i++]);
        } else {
          this.addField(name,type);
        };
      };
    };
    tis.addMethod = function(name,methodkind,params,vis,result,flags,options){
      // optional: vis, result, flags, options
      var t = this.$addMember(name,rtl.tTypeMemberMethod,vis?vis:2,options);
      t.methodkind = methodkind;
      t.procsig = rtl.newTIProcSig(params,result,flags);
      this.methods.push(name);
      return t;
    };
    tis.addProperty = function(name,flags,result,getter,setter,vis,options){
      var t = this.$addMember(name,rtl.tTypeMemberProperty,vis?vis:4,options);
      t.flags = flags;
      t.typeinfo = result;
      t.getter = getter;
      t.setter = setter;
      // Note: in options: params, stored, defaultvalue
      t.params = rtl.isArray(t.params) ? rtl.newTIParams(t.params) : null;
      this.properties.push(name);
      if (!rtl.isString(t.stored)) t.stored = "";
      return t;
    };
    tis.getField = function(index){
      return this.members[this.fields[index]];
    };
    tis.getMethod = function(index){
      return this.members[this.methods[index]];
    };
    tis.getProperty = function(index){
      return this.members[this.properties[index]];
    };

    newBaseTI("tTypeInfoRecord",12 /* tkRecord */,rtl.tTypeInfoStruct);
    newBaseTI("tTypeInfoClass",13 /* tkClass */,rtl.tTypeInfoStruct);
    newBaseTI("tTypeInfoClassRef",14 /* tkClassRef */);
    newBaseTI("tTypeInfoInterface",18 /* tkInterface */,rtl.tTypeInfoStruct);
    newBaseTI("tTypeInfoHelper",19 /* tkHelper */,rtl.tTypeInfoStruct);
    newBaseTI("tTypeInfoExtClass",20 /* tkExtClass */,rtl.tTypeInfoClass);
  },

  tSectionRTTI: {
    $module: null,
    $inherited: function(name,ancestor,o){
      if (rtl.debug_rtti){
        rtl.debug('tSectionRTTI.newTI "'+(this.$module?this.$module.$name:"(no module)")
          +'"."'+name+'" ('+ancestor.name+') '+(o?'init':'forward'));
      };
      var t = this[name];
      if (t){
        if (!t.$forward) throw 'duplicate type "'+name+'"';
        if (!ancestor.isPrototypeOf(t)) throw 'typeinfo ancestor mismatch "'+name+'" ancestor="'+ancestor.name+'" t.name="'+t.name+'"';
      } else {
        t = Object.create(ancestor);
        t.name = name;
        t.$module = this.$module;
        this[name] = t;
      }
      if (o){
        delete t.$forward;
        for (var key in o) if (o.hasOwnProperty(key)) t[key]=o[key];
      } else {
        t.$forward = true;
      }
      return t;
    },
    $Scope: function(name,ancestor,o){
      var t=this.$inherited(name,ancestor,o);
      t.members = {};
      t.names = [];
      t.fields = [];
      t.methods = [];
      t.properties = [];
      return t;
    },
    $TI: function(name,kind,o){ var t=this.$inherited(name,rtl.tTypeInfo,o); t.kind = kind; return t; },
    $Int: function(name,o){ return this.$inherited(name,rtl.tTypeInfoInteger,o); },
    $Enum: function(name,o){ return this.$inherited(name,rtl.tTypeInfoEnum,o); },
    $Set: function(name,o){ return this.$inherited(name,rtl.tTypeInfoSet,o); },
    $StaticArray: function(name,o){ return this.$inherited(name,rtl.tTypeInfoArray,o); },
    $DynArray: function(name,o){ return this.$inherited(name,rtl.tTypeInfoDynArray,o); },
    $ProcVar: function(name,o){ return this.$inherited(name,rtl.tTypeInfoProcVar,o); },
    $RefToProcVar: function(name,o){ return this.$inherited(name,rtl.tTypeInfoRefToProcVar,o); },
    $MethodVar: function(name,o){ return this.$inherited(name,rtl.tTypeInfoMethodVar,o); },
    $Record: function(name,o,typ){ if(typ) o.$record = typ; return this.$Scope(name,rtl.tTypeInfoRecord,o); },
    $Class: function(name,o){ return this.$Scope(name,rtl.tTypeInfoClass,o); },
    $ClassRef: function(name,o){ return this.$inherited(name,rtl.tTypeInfoClassRef,o); },
    $Pointer: function(name,o){ return this.$inherited(name,rtl.tTypeInfoPointer,o); },
    $Interface: function(name,o){ return this.$Scope(name,rtl.tTypeInfoInterface,o); },
    $Helper: function(name,o){ return this.$Scope(name,rtl.tTypeInfoHelper,o); },
    $ExtClass: function(name,o){ return this.$Scope(name,rtl.tTypeInfoExtClass,o); }
  },

  newTIParam: function(param){
    // param is an array, 0=name, 1=type, 2=optional flags
    var t = {
      name: param[0],
      typeinfo: param[1],
      flags: (rtl.isNumber(param[2]) ? param[2] : 0)
    };
    return t;
  },

  newTIParams: function(list){
    // list: optional array of [paramname,typeinfo,optional flags]
    var params = [];
    if (rtl.isArray(list)){
      for (var i=0; i<list.length; i++) params.push(rtl.newTIParam(list[i]));
    };
    return params;
  },

  newTIProcSig: function(params,result,flags){
    var s = {
      params: rtl.newTIParams(params),
      resulttype: result?result:null,
      flags: flags?flags:0
    };
    return s;
  },

  addResource: function(aRes){
    rtl.$res[aRes.name]=aRes;
  },

  getResource: function(aName){
    var res = rtl.$res[aName];
    if (res !== undefined) {
      return res;
    } else {
      return null;
    }
  },

  getResourceList: function(){
    return Object.keys(rtl.$res);
  }
}

rtl.module("System",[],function () {
  "use strict";
  var $mod = this;
  var $lt = null;
  rtl.createClass(this,"TObject",null,function () {
    $lt = this;
    this.$init = function () {
    };
    this.$final = function () {
    };
    this.AfterConstruction = function () {
    };
    this.BeforeDestruction = function () {
    };
  });
  this.Random = function (Range) {
    return Math.floor(Math.random()*Range);
  };
  this.Sqr$1 = function (A) {
    return A*A;
  };
  this.Trunc = function (A) {
    if (!Math.trunc) {
      Math.trunc = function(v) {
        v = +v;
        if (!isFinite(v)) return v;
        return (v - v % 1) || (v < 0 ? -0 : v === 0 ? v : 0);
      };
    }
    $mod.Trunc = Math.trunc;
    return Math.trunc(A);
  };
  this.Copy = function (S, Index, Size) {
    if (Index<1) Index = 1;
    return (Size>0) ? S.substring(Index-1,Index+Size-1) : "";
  };
  this.Copy$1 = function (S, Index) {
    if (Index<1) Index = 1;
    return S.substr(Index-1);
  };
  this.Delete = function (S, Index, Size) {
    var h = "";
    if ((Index < 1) || (Index > S.get().length) || (Size <= 0)) return;
    h = S.get();
    S.set($mod.Copy(h,1,Index - 1) + $mod.Copy$1(h,Index + Size));
  };
  this.Pos = function (Search, InString) {
    return InString.indexOf(Search)+1;
  };
  $mod.$init = function () {
    rtl.exitcode = 0;
  };
});
rtl.module("JS",["System"],function () {
  "use strict";
  var $mod = this;
  var $lt = null;
  var $lt1 = null;
  var $lt2 = null;
  var $lt3 = null;
});
rtl.module("weborworker",["System","JS"],function () {
  "use strict";
  var $mod = this;
  var $lt = null;
  var $lt1 = null;
  var $lt2 = null;
  var $lt3 = null;
  var $lt4 = null;
  var $lt5 = null;
  var $lt6 = null;
  var $lt7 = null;
});
rtl.module("Web",["System","JS","weborworker"],function () {
  "use strict";
  var $mod = this;
  var $lt = null;
  var $lt1 = null;
  var $lt2 = null;
  var $lt3 = null;
  var $lt4 = null;
  var $lt5 = null;
  var $lt6 = null;
  var $lt7 = null;
  var $lt8 = null;
  var $lt9 = null;
  var $lt10 = null;
});
rtl.module("Math",["System"],function () {
  "use strict";
  var $mod = this;
  var $lm = pas.System;
  var $lp = $lm.Trunc;
  this.Ceil = function (A) {
    var Result = 0;
    Result = $lp(Math.ceil(A));
    return Result;
  };
  this.Floor = function (A) {
    var Result = 0;
    Result = $lp(Math.floor(A));
    return Result;
  };
});
rtl.module("SysUtils",["System","JS"],function () {
  "use strict";
  var $mod = this;
  var $impl = $mod.$impl;
  var $lt = null;
  var $lt1 = null;
  var $lt2 = null;
  var $lt3 = null;
  var $lt4 = null;
  var $lt5 = null;
  var $lt6 = null;
  var $lm = pas.System;
  var $lt7 = $lm.TObject;
  var $lp = $lm.Pos;
  var $lp1 = $lm.Copy;
  var $lp2 = $lm.Delete;
  rtl.recNewT(this,"TFormatSettings",function () {
    $lt = this;
    this.CurrencyDecimals = 0;
    this.CurrencyFormat = 0;
    this.CurrencyString = "";
    this.DateSeparator = "\x00";
    this.DecimalSeparator = "";
    this.LongDateFormat = "";
    this.LongTimeFormat = "";
    this.NegCurrFormat = 0;
    this.ShortDateFormat = "";
    this.ShortTimeFormat = "";
    this.ThousandSeparator = "";
    this.TimeAMString = "";
    this.TimePMString = "";
    this.TimeSeparator = "\x00";
    this.TwoDigitYearCenturyWindow = 0;
    this.InitLocaleHandler = null;
    this.$new = function () {
      var r = Object.create(this);
      r.DateTimeToStrFormat = rtl.arraySetLength(null,"",2);
      r.LongDayNames = rtl.arraySetLength(null,"",7);
      r.LongMonthNames = rtl.arraySetLength(null,"",12);
      r.ShortDayNames = rtl.arraySetLength(null,"",7);
      r.ShortMonthNames = rtl.arraySetLength(null,"",12);
      return r;
    };
    this.$eq = function (b) {
      return (this.CurrencyDecimals === b.CurrencyDecimals) && (this.CurrencyFormat === b.CurrencyFormat) && (this.CurrencyString === b.CurrencyString) && (this.DateSeparator === b.DateSeparator) && rtl.arrayEq(this.DateTimeToStrFormat,b.DateTimeToStrFormat) && (this.DecimalSeparator === b.DecimalSeparator) && (this.LongDateFormat === b.LongDateFormat) && rtl.arrayEq(this.LongDayNames,b.LongDayNames) && rtl.arrayEq(this.LongMonthNames,b.LongMonthNames) && (this.LongTimeFormat === b.LongTimeFormat) && (this.NegCurrFormat === b.NegCurrFormat) && (this.ShortDateFormat === b.ShortDateFormat) && rtl.arrayEq(this.ShortDayNames,b.ShortDayNames) && rtl.arrayEq(this.ShortMonthNames,b.ShortMonthNames) && (this.ShortTimeFormat === b.ShortTimeFormat) && (this.ThousandSeparator === b.ThousandSeparator) && (this.TimeAMString === b.TimeAMString) && (this.TimePMString === b.TimePMString) && (this.TimeSeparator === b.TimeSeparator) && (this.TwoDigitYearCenturyWindow === b.TwoDigitYearCenturyWindow);
    };
    this.$assign = function (s) {
      this.CurrencyDecimals = s.CurrencyDecimals;
      this.CurrencyFormat = s.CurrencyFormat;
      this.CurrencyString = s.CurrencyString;
      this.DateSeparator = s.DateSeparator;
      this.DateTimeToStrFormat = s.DateTimeToStrFormat.slice(0);
      this.DecimalSeparator = s.DecimalSeparator;
      this.LongDateFormat = s.LongDateFormat;
      this.LongDayNames = s.LongDayNames.slice(0);
      this.LongMonthNames = s.LongMonthNames.slice(0);
      this.LongTimeFormat = s.LongTimeFormat;
      this.NegCurrFormat = s.NegCurrFormat;
      this.ShortDateFormat = s.ShortDateFormat;
      this.ShortDayNames = s.ShortDayNames.slice(0);
      this.ShortMonthNames = s.ShortMonthNames.slice(0);
      this.ShortTimeFormat = s.ShortTimeFormat;
      this.ThousandSeparator = s.ThousandSeparator;
      this.TimeAMString = s.TimeAMString;
      this.TimePMString = s.TimePMString;
      this.TimeSeparator = s.TimeSeparator;
      this.TwoDigitYearCenturyWindow = s.TwoDigitYearCenturyWindow;
      return this;
    };
    this.GetJSLocale = function () {
      return Intl.DateTimeFormat().resolvedOptions().locale;
    };
    this.Create = function () {
      var Result = $lt.$new();
      Result.$assign($lt.Create$1($lt.GetJSLocale()));
      return Result;
    };
    this.Create$1 = function (ALocale) {
      var Result = $lt.$new();
      Result.LongDayNames = $impl.DefaultLongDayNames.slice(0);
      Result.ShortDayNames = $impl.DefaultShortDayNames.slice(0);
      Result.ShortMonthNames = $impl.DefaultShortMonthNames.slice(0);
      Result.LongMonthNames = $impl.DefaultLongMonthNames.slice(0);
      Result.DateTimeToStrFormat[0] = "c";
      Result.DateTimeToStrFormat[1] = "f";
      Result.DateSeparator = "-";
      Result.TimeSeparator = ":";
      Result.ShortDateFormat = "yyyy-mm-dd";
      Result.LongDateFormat = "ddd, yyyy-mm-dd";
      Result.ShortTimeFormat = "hh:nn";
      Result.LongTimeFormat = "hh:nn:ss";
      Result.DecimalSeparator = ".";
      Result.ThousandSeparator = ",";
      Result.TimeAMString = "AM";
      Result.TimePMString = "PM";
      Result.TwoDigitYearCenturyWindow = 50;
      Result.CurrencyFormat = 0;
      Result.NegCurrFormat = 0;
      Result.CurrencyDecimals = 2;
      Result.CurrencyString = "$";
      if ($lt.InitLocaleHandler != null) $lt.InitLocaleHandler($mod.UpperCase(ALocale),$lt.$clone(Result));
      return Result;
    };
  },true);
  rtl.createClass(this,"Exception",$lt7,function () {
    $lt1 = this;
  });
  rtl.createClass(this,"EExternal",$lt1,function () {
    $lt2 = this;
  });
  rtl.createClass(this,"EInvalidCast",$lt1,function () {
    $lt3 = this;
  });
  rtl.createClass(this,"EIntError",$lt2,function () {
    $lt4 = this;
  });
  rtl.createClass(this,"ERangeError",$lt4,function () {
    $lt5 = this;
  });
  rtl.createClass(this,"EAbstractError",$lt1,function () {
    $lt6 = this;
  });
  this.UpperCase = function (s) {
    return s.toUpperCase();
  };
  this.LowerCase = function (s) {
    return s.toLowerCase();
  };
  this.IntToStr = function (Value) {
    var Result = "";
    Result = "" + Value;
    return Result;
  };
  this.TryStrToInt$2 = function (S, res) {
    var Result = false;
    Result = $impl.IntTryStrToInt(S,res,$mod.FormatSettings.DecimalSeparator);
    return Result;
  };
  this.StrToIntDef = function (S, aDef) {
    var Result = 0;
    var R = 0;
    if ($mod.TryStrToInt$2(S,{get: function () {
        return R;
      }, set: function (v) {
        R = v;
      }})) {
      Result = R}
     else Result = aDef;
    return Result;
  };
  this.TimeSeparator = "\x00";
  this.DateSeparator = "\x00";
  this.ShortDateFormat = "";
  this.LongDateFormat = "";
  this.ShortTimeFormat = "";
  this.LongTimeFormat = "";
  this.DecimalSeparator = "";
  this.ThousandSeparator = "";
  this.TimeAMString = "";
  this.TimePMString = "";
  this.ShortMonthNames = rtl.arraySetLength(null,"",12);
  this.LongMonthNames = rtl.arraySetLength(null,"",12);
  this.ShortDayNames = rtl.arraySetLength(null,"",7);
  this.LongDayNames = rtl.arraySetLength(null,"",7);
  this.FormatSettings = $lt.$new();
  this.CurrencyFormat = 0;
  this.NegCurrFormat = 0;
  this.CurrencyDecimals = 0;
  this.CurrencyString = "";
  $mod.$implcode = function () {
    $impl.DefaultShortMonthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    $impl.DefaultLongMonthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    $impl.DefaultShortDayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    $impl.DefaultLongDayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    $impl.IntTryStrToInt = function (S, res, aSep) {
      var Result = false;
      var Radix = 10;
      var N = "";
      var J = undefined;
      N = S;
      if (($lp(aSep,N) !== 0) || ($lp(".",N) !== 0)) return false;
      var $tmp = $lp1(N,1,1);
      if ($tmp === "$") {
        Radix = 16}
       else if ($tmp === "&") {
        Radix = 8}
       else if ($tmp === "%") Radix = 2;
      if ((Radix !== 16) && ($lp("e",$mod.LowerCase(N)) !== 0)) return false;
      if (Radix !== 10) $lp2({get: function () {
          return N;
        }, set: function (v) {
          N = v;
        }},1,1);
      J = parseInt(N,Radix);
      Result = !isNaN(J);
      if (Result) res.set(rtl.trunc(J));
      return Result;
    };
    $impl.InitGlobalFormatSettings = function () {
      $mod.FormatSettings.$assign($lt.Create());
      $mod.TimeSeparator = $mod.FormatSettings.TimeSeparator;
      $mod.DateSeparator = $mod.FormatSettings.DateSeparator;
      $mod.ShortDateFormat = $mod.FormatSettings.ShortDateFormat;
      $mod.LongDateFormat = $mod.FormatSettings.LongDateFormat;
      $mod.ShortTimeFormat = $mod.FormatSettings.ShortTimeFormat;
      $mod.LongTimeFormat = $mod.FormatSettings.LongTimeFormat;
      $mod.DecimalSeparator = $mod.FormatSettings.DecimalSeparator;
      $mod.ThousandSeparator = $mod.FormatSettings.ThousandSeparator;
      $mod.TimeAMString = $mod.FormatSettings.TimeAMString;
      $mod.TimePMString = $mod.FormatSettings.TimePMString;
      $mod.CurrencyFormat = $mod.FormatSettings.CurrencyFormat;
      $mod.NegCurrFormat = $mod.FormatSettings.NegCurrFormat;
      $mod.CurrencyDecimals = $mod.FormatSettings.CurrencyDecimals;
      $mod.CurrencyString = $mod.FormatSettings.CurrencyString;
    };
    $impl.DoClassRef = function (C) {
      if (C === null) ;
    };
  };
  $mod.$init = function () {
    (function () {
      $impl.InitGlobalFormatSettings();
    })();
    $impl.DoClassRef($lt3);
    $impl.DoClassRef($lt6);
    $impl.DoClassRef($lt5);
    $mod.ShortMonthNames = $impl.DefaultShortMonthNames.slice(0);
    $mod.LongMonthNames = $impl.DefaultLongMonthNames.slice(0);
    $mod.ShortDayNames = $impl.DefaultShortDayNames.slice(0);
    $mod.LongDayNames = $impl.DefaultLongDayNames.slice(0);
  };
},[]);
rtl.module("program",["System","JS","Web","Math","weborworker","SysUtils"],function () {
  "use strict";
  var $mod = this;
  var $lt = null;
  var $lt1 = null;
  var $lt2 = null;
  var $lt3 = null;
  var $lt4 = null;
  var $lm = pas.Math;
  var $lp = $lm.Floor;
  var $lp1 = $lm.Ceil;
  var $lm1 = pas.System;
  var $lp2 = $lm1.Sqr$1;
  var $lp3 = $lm1.Random;
  var $lm2 = pas.SysUtils;
  var $lp4 = $lm2.IntToStr;
  var $lp5 = $lm2.StrToIntDef;
  this.MaxSize = 512;
  this.Epsilon = -0.1;
  this.NonImprovementThreshold = 20;
  this.StopRequested = false;
  rtl.recNewT(this,"TFloatColor",function () {
    $lt = this;
    this.r = 0.0;
    this.g = 0.0;
    this.b = 0.0;
    this.$eq = function (b) {
      return (this.r === b.r) && (this.g === b.g) && (this.b === b.b);
    };
    this.$assign = function (s) {
      this.r = s.r;
      this.g = s.g;
      this.b = s.b;
      return this;
    };
  });
  rtl.recNewT(this,"TVertex",function () {
    $lt1 = this;
    this.x = 0.0;
    this.y = 0.0;
    this.$eq = function (b) {
      return (this.x === b.x) && (this.y === b.y);
    };
    this.$assign = function (s) {
      this.x = s.x;
      this.y = s.y;
      return this;
    };
  });
  this.TPolyVertices$clone = function (a) {
    var b = [];
    b.length = 3;
    for (var c = 0; c < 3; c++) b[c] = $lt1.$clone(a[c]);
    return b;
  };
  rtl.recNewT(this,"TPolygon",function () {
    $lt2 = this;
    this.$new = function () {
      var r = Object.create(this);
      r.vertices = rtl.arraySetLength(null,$lt1,3);
      r.color = $lt.$new();
      return r;
    };
    this.$eq = function (b) {
      return rtl.arrayEq(this.vertices,b.vertices) && this.color.$eq(b.color);
    };
    this.$assign = function (s) {
      this.vertices = $mod.TPolyVertices$clone(s.vertices);
      this.color.$assign(s.color);
      return this;
    };
  });
  rtl.recNewT(this,"TRasterizedPolygon",function () {
    $lt3 = this;
    this.xi_min = 0;
    this.xi_max = 0;
    this.yi_min = 0;
    this.yi_max = 0;
    this.bh = 0;
    this.bw = 0;
    this.delta = 0.0;
    this.$new = function () {
      var r = Object.create(this);
      r.poly = $lt2.$new();
      r.mask = [];
      return r;
    };
    this.$eq = function (b) {
      return this.poly.$eq(b.poly) && (this.mask === b.mask) && (this.xi_min === b.xi_min) && (this.xi_max === b.xi_max) && (this.yi_min === b.yi_min) && (this.yi_max === b.yi_max) && (this.bh === b.bh) && (this.bw === b.bw) && (this.delta === b.delta);
    };
    this.$assign = function (s) {
      this.poly.$assign(s.poly);
      this.mask = rtl.arrayRef(s.mask);
      this.xi_min = s.xi_min;
      this.xi_max = s.xi_max;
      this.yi_min = s.yi_min;
      this.yi_max = s.yi_max;
      this.bh = s.bh;
      this.bw = s.bw;
      this.delta = s.delta;
      return this;
    };
  });
  rtl.recNewT(this,"TAnnealingSchedule",function () {
    $lt4 = this;
    this.T_init = 0.0;
    this.T_final = 0.0;
    this.Sigma_init = 0.0;
    this.Sigma_final = 0.0;
    this.N_steps = 0;
    this.$eq = function (b) {
      return (this.T_init === b.T_init) && (this.T_final === b.T_final) && (this.Sigma_init === b.Sigma_init) && (this.Sigma_final === b.Sigma_final) && (this.N_steps === b.N_steps);
    };
    this.$assign = function (s) {
      this.T_init = s.T_init;
      this.T_final = s.T_final;
      this.Sigma_init = s.Sigma_init;
      this.Sigma_final = s.Sigma_final;
      this.N_steps = s.N_steps;
      return this;
    };
  });
  this.Randn = function () {
    var Result = 0.0;
    var u1 = 0.0;
    var u2 = 0.0;
    u1 = Math.random();
    while (u1 === 0.0) u1 = Math.random();
    u2 = Math.random();
    Result = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return Result;
  };
  this.BoundingBox = function (verts, x_min, x_max, y_min, y_max) {
    x_min.set(Math.min(verts[0].x,Math.min(verts[1].x,verts[2].x)));
    x_max.set(Math.max(verts[0].x,Math.max(verts[1].x,verts[2].x)));
    y_min.set(Math.min(verts[0].y,Math.min(verts[1].y,verts[2].y)));
    y_max.set(Math.max(verts[0].y,Math.max(verts[1].y,verts[2].y)));
  };
  this.ToPixelRange = function (x_min, x_max, y_min, y_max, H, W, xi_min, xi_max, yi_min, yi_max) {
    xi_min.set(Math.max(0,$lp(x_min * W)));
    xi_max.set(Math.min(W - 1,$lp1(x_max * W)));
    yi_min.set(Math.max(0,$lp(y_min * H)));
    yi_max.set(Math.min(H - 1,$lp1(y_max * H)));
  };
  this.EdgeFn = function (ax, ay, bx, by, px, py) {
    var Result = 0.0;
    Result = ((px - bx) * (ay - by)) - ((ax - bx) * (py - by));
    return Result;
  };
  this.Rasterize = function (poly, H, W, rpoly) {
    var x_min = 0.0;
    var x_max = 0.0;
    var y_min = 0.0;
    var y_max = 0.0;
    var i = 0;
    var j = 0;
    var idx = 0;
    var px = 0.0;
    var py = 0.0;
    var d1 = 0.0;
    var d2 = 0.0;
    var d3 = 0.0;
    var has_neg = false;
    var has_pos = false;
    var ax = 0.0;
    var ay = 0.0;
    var bx = 0.0;
    var by = 0.0;
    var cx = 0.0;
    var cy = 0.0;
    $mod.BoundingBox(poly.vertices,{get: function () {
        return x_min;
      }, set: function (v) {
        x_min = v;
      }},{get: function () {
        return x_max;
      }, set: function (v) {
        x_max = v;
      }},{get: function () {
        return y_min;
      }, set: function (v) {
        y_min = v;
      }},{get: function () {
        return y_max;
      }, set: function (v) {
        y_max = v;
      }});
    $mod.ToPixelRange(x_min,x_max,y_min,y_max,H,W,{p: rpoly, get: function () {
        return this.p.xi_min;
      }, set: function (v) {
        this.p.xi_min = v;
      }},{p: rpoly, get: function () {
        return this.p.xi_max;
      }, set: function (v) {
        this.p.xi_max = v;
      }},{p: rpoly, get: function () {
        return this.p.yi_min;
      }, set: function (v) {
        this.p.yi_min = v;
      }},{p: rpoly, get: function () {
        return this.p.yi_max;
      }, set: function (v) {
        this.p.yi_max = v;
      }});
    rpoly.bh = Math.max(0,(rpoly.yi_max - rpoly.yi_min) + 1);
    rpoly.bw = Math.max(0,(rpoly.xi_max - rpoly.xi_min) + 1);
    rpoly.poly.$assign(poly);
    rpoly.delta = 0.0;
    rpoly.mask = rtl.arraySetLength(rpoly.mask,false,rpoly.bh * rpoly.bw);
    if ((rpoly.bh === 0) || (rpoly.bw === 0)) return;
    ax = poly.vertices[0].x * W;
    ay = poly.vertices[0].y * H;
    bx = poly.vertices[1].x * W;
    by = poly.vertices[1].y * H;
    cx = poly.vertices[2].x * W;
    cy = poly.vertices[2].y * H;
    idx = 0;
    for (var $l = 0, $end = rpoly.bh - 1; $l <= $end; $l++) {
      i = $l;
      py = rpoly.yi_min + i + 0.5;
      for (var $l1 = 0, $end1 = rpoly.bw - 1; $l1 <= $end1; $l1++) {
        j = $l1;
        px = rpoly.xi_min + j + 0.5;
        d1 = $mod.EdgeFn(ax,ay,bx,by,px,py);
        d2 = $mod.EdgeFn(bx,by,cx,cy,px,py);
        d3 = $mod.EdgeFn(cx,cy,ax,ay,px,py);
        has_neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        has_pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        rpoly.mask[idx] = !(has_neg && has_pos);
        idx += 1;
      };
    };
  };
  this.OptimalColor = function (rpoly, Canvas, Target, W, Alpha) {
    var Result = $lt.$new();
    var i = 0;
    var j = 0;
    var idx = 0;
    var canvasIdx = 0;
    var n = 0;
    var accR = 0.0;
    var accG = 0.0;
    var accB = 0.0;
    n = 0;
    for (var $l = 0, $end = rtl.length(rpoly.mask) - 1; $l <= $end; $l++) {
      i = $l;
      if (rpoly.mask[i]) n += 1;
    };
    if (n === 0) {
      Result.r = 0.5;
      Result.g = 0.5;
      Result.b = 0.5;
      return Result;
    };
    accR = 0.0;
    accG = 0.0;
    accB = 0.0;
    idx = 0;
    for (var $l1 = 0, $end1 = rpoly.bh - 1; $l1 <= $end1; $l1++) {
      i = $l1;
      for (var $l2 = 0, $end2 = rpoly.bw - 1; $l2 <= $end2; $l2++) {
        j = $l2;
        if (rpoly.mask[idx]) {
          canvasIdx = ((rpoly.yi_min + i) * W) + (rpoly.xi_min + j);
          accR = (accR + Target[canvasIdx].r) - ((1.0 - Alpha) * Canvas[canvasIdx].r);
          accG = (accG + Target[canvasIdx].g) - ((1.0 - Alpha) * Canvas[canvasIdx].g);
          accB = (accB + Target[canvasIdx].b) - ((1.0 - Alpha) * Canvas[canvasIdx].b);
        };
        idx += 1;
      };
    };
    Result.r = accR / (Alpha * n);
    Result.g = accG / (Alpha * n);
    Result.b = accB / (Alpha * n);
    if (Result.r < 0.0) {
      Result.r = 0.0}
     else if (Result.r > 1.0) Result.r = 1.0;
    if (Result.g < 0.0) {
      Result.g = 0.0}
     else if (Result.g > 1.0) Result.g = 1.0;
    if (Result.b < 0.0) {
      Result.b = 0.0}
     else if (Result.b > 1.0) Result.b = 1.0;
    return Result;
  };
  this.ScoreDelta = function (rpoly, Canvas, Target, W, Alpha) {
    var Result = 0.0;
    var i = 0;
    var j = 0;
    var idx = 0;
    var canvasIdx = 0;
    var cvR = 0.0;
    var cvG = 0.0;
    var cvB = 0.0;
    var tvR = 0.0;
    var tvG = 0.0;
    var tvB = 0.0;
    var bvR = 0.0;
    var bvG = 0.0;
    var bvB = 0.0;
    var colR = 0.0;
    var colG = 0.0;
    var colB = 0.0;
    Result = 0.0;
    colR = rpoly.poly.color.r;
    colG = rpoly.poly.color.g;
    colB = rpoly.poly.color.b;
    idx = 0;
    for (var $l = 0, $end = rpoly.bh - 1; $l <= $end; $l++) {
      i = $l;
      for (var $l1 = 0, $end1 = rpoly.bw - 1; $l1 <= $end1; $l1++) {
        j = $l1;
        if (rpoly.mask[idx]) {
          canvasIdx = ((rpoly.yi_min + i) * W) + (rpoly.xi_min + j);
          cvR = Canvas[canvasIdx].r;
          cvG = Canvas[canvasIdx].g;
          cvB = Canvas[canvasIdx].b;
          tvR = Target[canvasIdx].r;
          tvG = Target[canvasIdx].g;
          tvB = Target[canvasIdx].b;
          bvR = ((1.0 - Alpha) * cvR) + (Alpha * colR);
          bvG = ((1.0 - Alpha) * cvG) + (Alpha * colG);
          bvB = ((1.0 - Alpha) * cvB) + (Alpha * colB);
          Result = Result + ($lp2(bvR - tvR) - $lp2(cvR - tvR)) + ($lp2(bvG - tvG) - $lp2(cvG - tvG)) + ($lp2(bvB - tvB) - $lp2(cvB - tvB));
        };
        idx += 1;
      };
    };
    return Result;
  };
  this.InitializePolygon = function (Canvas, Target, H, W, Alpha) {
    var Result = $lt3.$new();
    var ErrorMap = [];
    var TotalError = 0.0;
    var RndVal = 0.0;
    var Acc = 0.0;
    var i = 0;
    var k = 0;
    var verts = rtl.arraySetLength(null,$lt1,3);
    var poly = $lt2.$new();
    ErrorMap = rtl.arraySetLength(ErrorMap,0.0,H * W);
    TotalError = 0.0;
    for (var $l = 0, $end = (H * W) - 1; $l <= $end; $l++) {
      i = $l;
      ErrorMap[i] = $lp2(Target[i].r - Canvas[i].r) + $lp2(Target[i].g - Canvas[i].g) + $lp2(Target[i].b - Canvas[i].b);
      TotalError = TotalError + ErrorMap[i];
    };
    for (k = 0; k <= 2; k++) {
      RndVal = Math.random() * TotalError;
      Acc = 0.0;
      verts[k].x = 0.5;
      verts[k].y = 0.5;
      for (var $l1 = 0, $end1 = (H * W) - 1; $l1 <= $end1; $l1++) {
        i = $l1;
        Acc = Acc + ErrorMap[i];
        if (Acc >= RndVal) {
          verts[k].x = ((i % W) + 0.5) / W;
          verts[k].y = (rtl.trunc(i / W) + 0.5) / H;
          break;
        };
      };
    };
    poly.vertices = $mod.TPolyVertices$clone(verts);
    poly.color.r = 0.5;
    poly.color.g = 0.5;
    poly.color.b = 0.5;
    $mod.Rasterize(poly,H,W,Result);
    poly.color.$assign($mod.OptimalColor(Result,Canvas,Target,W,Alpha));
    Result.poly.color.$assign(poly.color);
    Result.delta = $mod.ScoreDelta(Result,Canvas,Target,W,Alpha);
    return Result;
  };
  this.MutateVertices = function (verts, Sigma) {
    var Result = rtl.arraySetLength(null,$lt1,3);
    var r = 0.0;
    var dx = 0.0;
    var dy = 0.0;
    var ScaleFactor = 0.0;
    var i = 0;
    var centroid = $lt1.$new();
    var Theta = 0.0;
    var C = 0.0;
    var S = 0.0;
    Result = $mod.TPolyVertices$clone(verts);
    r = Math.random();
    if (r < 0.50) {
      i = $lp3(3);
      Result[i].x = Result[i].x + ($mod.Randn() * Sigma);
      Result[i].y = Result[i].y + ($mod.Randn() * Sigma);
    } else if (r < 0.75) {
      dx = $mod.Randn() * Sigma;
      dy = $mod.Randn() * Sigma;
      for (i = 0; i <= 2; i++) {
        Result[i].x = Result[i].x + dx;
        Result[i].y = Result[i].y + dy;
      };
    } else if (r < 0.875) {
      centroid.x = (Result[0].x + Result[1].x + Result[2].x) / 3.0;
      centroid.y = (Result[0].y + Result[1].y + Result[2].y) / 3.0;
      ScaleFactor = 1.0 + ($mod.Randn() * Sigma);
      for (i = 0; i <= 2; i++) {
        Result[i].x = centroid.x + ((Result[i].x - centroid.x) * ScaleFactor);
        Result[i].y = centroid.y + ((Result[i].y - centroid.y) * ScaleFactor);
      };
    } else {
      centroid.x = (Result[0].x + Result[1].x + Result[2].x) / 3.0;
      centroid.y = (Result[0].y + Result[1].y + Result[2].y) / 3.0;
      Theta = $mod.Randn() * Sigma * Math.PI;
      C = Math.cos(Theta);
      S = Math.sin(Theta);
      for (i = 0; i <= 2; i++) {
        dx = Result[i].x - centroid.x;
        dy = Result[i].y - centroid.y;
        Result[i].x = (centroid.x + (dx * C)) - (dy * S);
        Result[i].y = centroid.y + (dx * S) + (dy * C);
      };
    };
    for (i = 0; i <= 2; i++) {
      if (Result[i].x < 0.0) {
        Result[i].x = 0.0}
       else if (Result[i].x > 1.0) Result[i].x = 1.0;
      if (Result[i].y < 0.0) {
        Result[i].y = 0.0}
       else if (Result[i].y > 1.0) Result[i].y = 1.0;
    };
    return Result;
  };
  this.Temperature = function (sched, Step, T, Sigma) {
    var Alpha = 0.0;
    Alpha = Step / sched.N_steps;
    T.set(sched.T_init * Math.pow(sched.T_final / sched.T_init,Alpha));
    Sigma.set(sched.Sigma_init * Math.pow(sched.Sigma_final / sched.Sigma_init,Alpha));
  };
  this.AdaptiveSchedule = function (base, Progress) {
    var Result = $lt4.$new();
    Result.$assign(base);
    Result.N_steps = Math.round(base.N_steps * (0.5 + Progress));
    Result.Sigma_init = base.Sigma_init * (1.0 - (0.8 * Progress));
    return Result;
  };
  this.CalibrateTInit = function (Canvas, Target, H, W, Alpha) {
    var Result = 0.0;
    var rpoly = $lt3.$new();
    var cand_r = $lt3.$new();
    var i = 0;
    var count_uphill = 0;
    var cand_poly = $lt2.$new();
    var DeltaE = 0.0;
    var sum_uphill = 0.0;
    var mean_uphill = 0.0;
    rpoly.$assign($mod.InitializePolygon(Canvas,Target,H,W,Alpha));
    sum_uphill = 0.0;
    count_uphill = 0;
    for (i = 0; i <= 199; i++) {
      cand_poly.vertices = $mod.MutateVertices(rpoly.poly.vertices,0.3);
      cand_poly.color.r = 0.5;
      cand_poly.color.g = 0.5;
      cand_poly.color.b = 0.5;
      $mod.Rasterize(cand_poly,H,W,cand_r);
      cand_poly.color.$assign($mod.OptimalColor(cand_r,Canvas,Target,W,Alpha));
      cand_r.poly.color.$assign(cand_poly.color);
      DeltaE = $mod.ScoreDelta(cand_r,Canvas,Target,W,Alpha) - rpoly.delta;
      if (DeltaE > 0.0) {
        sum_uphill = sum_uphill + DeltaE;
        count_uphill += 1;
      };
    };
    if (count_uphill > 0) {
      mean_uphill = sum_uphill / 200.0}
     else mean_uphill = 0.0;
    if (mean_uphill === 0.0) {
      Result = 0.01}
     else Result = -mean_uphill / Math.log(0.8);
    return Result;
  };
  this.FitPolygon = function (Canvas, Target, Sched, H, W, Alpha) {
    var Result = $lt3.$new();
    var rpoly = $lt3.$new();
    var best_rpoly = $lt3.$new();
    var cand_r = $lt3.$new();
    var current_delta = 0.0;
    var best_delta = 0.0;
    var cand_delta = 0.0;
    var DeltaE = 0.0;
    var T = 0.0;
    var Sigma = 0.0;
    var step = 0;
    var cand_poly = $lt2.$new();
    rpoly.$assign($mod.InitializePolygon(Canvas,Target,H,W,Alpha));
    current_delta = rpoly.delta;
    best_rpoly.$assign(rpoly);
    best_rpoly.mask = rtl.arrayCopy(0,rpoly.mask,0);
    best_delta = current_delta;
    for (var $l = 1, $end = Sched.N_steps; $l <= $end; $l++) {
      step = $l;
      $mod.Temperature(Sched,step,{get: function () {
          return T;
        }, set: function (v) {
          T = v;
        }},{get: function () {
          return Sigma;
        }, set: function (v) {
          Sigma = v;
        }});
      cand_poly.vertices = $mod.MutateVertices(rpoly.poly.vertices,Sigma);
      cand_poly.color.r = 0.5;
      cand_poly.color.g = 0.5;
      cand_poly.color.b = 0.5;
      $mod.Rasterize(cand_poly,H,W,cand_r);
      cand_poly.color.$assign($mod.OptimalColor(cand_r,Canvas,Target,W,Alpha));
      cand_r.poly.color.$assign(cand_poly.color);
      cand_delta = $mod.ScoreDelta(cand_r,Canvas,Target,W,Alpha);
      DeltaE = cand_delta - current_delta;
      if ((DeltaE < 0) || (Math.random() < Math.exp(-DeltaE / T))) {
        rpoly.$assign(cand_r);
        rpoly.mask = rtl.arrayCopy(0,cand_r.mask,0);
        rpoly.delta = cand_delta;
        current_delta = cand_delta;
        if (current_delta < best_delta) {
          best_rpoly.$assign(rpoly);
          best_rpoly.mask = rtl.arrayCopy(0,rpoly.mask,0);
          best_delta = current_delta;
        };
      };
    };
    Result.$assign(best_rpoly);
    return Result;
  };
  this.CommitPolygon = function (Canvas, rpoly, W, Alpha) {
    var i = 0;
    var j = 0;
    var idx = 0;
    var canvasIdx = 0;
    idx = 0;
    for (var $l = 0, $end = rpoly.bh - 1; $l <= $end; $l++) {
      i = $l;
      for (var $l1 = 0, $end1 = rpoly.bw - 1; $l1 <= $end1; $l1++) {
        j = $l1;
        if (rpoly.mask[idx]) {
          canvasIdx = ((rpoly.yi_min + i) * W) + (rpoly.xi_min + j);
          Canvas.get()[canvasIdx].r = ((1.0 - Alpha) * Canvas.get()[canvasIdx].r) + (Alpha * rpoly.poly.color.r);
          Canvas.get()[canvasIdx].g = ((1.0 - Alpha) * Canvas.get()[canvasIdx].g) + (Alpha * rpoly.poly.color.g);
          Canvas.get()[canvasIdx].b = ((1.0 - Alpha) * Canvas.get()[canvasIdx].b) + (Alpha * rpoly.poly.color.b);
        };
        idx += 1;
      };
    };
  };
  this.TotalScore = function (Canvas, Target) {
    var Result = 0.0;
    var i = 0;
    Result = 0.0;
    for (var $l = 0, $end = rtl.length(Canvas) - 1; $l <= $end; $l++) {
      i = $l;
      Result = Result + $lp2(Canvas[i].r - Target[i].r) + $lp2(Canvas[i].g - Target[i].g) + $lp2(Canvas[i].b - Target[i].b);
    };
    return Result;
  };
  this.InitCanvas = function (Target, Canvas) {
    var i = 0;
    var TotalPixels = 0;
    var sumR = 0.0;
    var sumG = 0.0;
    var sumB = 0.0;
    var meanR = 0.0;
    var meanG = 0.0;
    var meanB = 0.0;
    TotalPixels = rtl.length(Target);
    sumR = 0;
    sumG = 0;
    sumB = 0;
    for (var $l = 0, $end = TotalPixels - 1; $l <= $end; $l++) {
      i = $l;
      sumR = sumR + Target[i].r;
      sumG = sumG + Target[i].g;
      sumB = sumB + Target[i].b;
    };
    meanR = sumR / TotalPixels;
    meanG = sumG / TotalPixels;
    meanB = sumB / TotalPixels;
    for (var $l1 = 0, $end1 = TotalPixels - 1; $l1 <= $end1; $l1++) {
      i = $l1;
      Canvas.get()[i].r = meanR;
      Canvas.get()[i].g = meanG;
      Canvas.get()[i].b = meanB;
    };
  };
  this.TargetArray = [];
  this.CanvasArray = [];
  this.TargetCtx = null;
  this.ReconstructCtx = null;
  this.CanvasData = null;
  this.ImgWidth = 0;
  this.ImgHeight = 0;
  this.BaseSched = $lt4.$new();
  this.Iteration = 0;
  this.PolygonsCommitted = 0;
  this.FailCount = 0;
  this.InitialScore = 0.0;
  this.CurrentScore = 0.0;
  this.IsRunning = false;
  this.UpdateScreen = function () {
    var i = 0;
    var p = 0;
    p = 0;
    for (var $l = 0, $end = ($mod.ImgWidth * $mod.ImgHeight) - 1; $l <= $end; $l++) {
      i = $l;
      $mod.CanvasData.data[p] = Math.round($mod.CanvasArray[i].r * 255);
      $mod.CanvasData.data[p + 1] = Math.round($mod.CanvasArray[i].g * 255);
      $mod.CanvasData.data[p + 2] = Math.round($mod.CanvasArray[i].b * 255);
      $mod.CanvasData.data[p + 3] = 255;
      p += 4;
    };
    $mod.ReconstructCtx.putImageData($mod.CanvasData,0,0);
  };
  this.DoNextFrame = function (Time) {
    var Progress = 0.0;
    var Sched = $lt4.$new();
    var rpoly = $lt3.$new();
    if (!$mod.IsRunning) return;
    $mod.Iteration += 1;
    Progress = -Math.log($mod.CurrentScore / $mod.InitialScore) / 4.60517;
    if (Progress < 0) Progress = 0;
    if (Progress > 1) Progress = 1;
    Sched.$assign($mod.AdaptiveSchedule($mod.BaseSched,Progress));
    rpoly.$assign($mod.FitPolygon($mod.CanvasArray,$mod.TargetArray,Sched,$mod.ImgHeight,$mod.ImgWidth,0.5));
    if (rpoly.delta < -0.1) {
      $mod.CommitPolygon({p: $mod, get: function () {
          return this.p.CanvasArray;
        }, set: function (v) {
          this.p.CanvasArray = v;
        }},rpoly,$mod.ImgWidth,0.5);
      $mod.PolygonsCommitted += 1;
      $mod.CurrentScore = $mod.TotalScore($mod.CanvasArray,$mod.TargetArray);
      $mod.FailCount = 0;
      $mod.UpdateScreen();
      document.getElementById("statusText").innerHTML = "Polygons: " + $lp4($mod.PolygonsCommitted) + " | Progress: " + $lp4(Math.round(Progress * 100)) + "%";
    } else $mod.FailCount += 1;
    if (!$mod.StopRequested && ($mod.FailCount < $mod.NonImprovementThreshold)) {
      window.requestAnimationFrame($mod.DoNextFrame)}
     else {
      $mod.IsRunning = false;
      if ($mod.StopRequested) {
        document.getElementById("finalText").innerHTML = "User requested stop."}
       else document.getElementById("finalText").innerHTML = "Finished!";
    };
  };
  this.StartReconstruction = function () {
    $mod.InitialScore = $mod.TotalScore($mod.CanvasArray,$mod.TargetArray);
    $mod.CurrentScore = $mod.InitialScore;
    $mod.BaseSched.T_init = $mod.CalibrateTInit($mod.CanvasArray,$mod.TargetArray,$mod.ImgHeight,$mod.ImgWidth,0.5);
    $mod.BaseSched.T_final = 1e-6;
    $mod.BaseSched.Sigma_init = 0.3;
    $mod.BaseSched.Sigma_final = 0.005;
    $mod.BaseSched.N_steps = 2000;
    $mod.Iteration = 0;
    $mod.FailCount = 0;
    $mod.PolygonsCommitted = 0;
    $mod.IsRunning = true;
    $mod.StopRequested = false;
    document.getElementById("finalText").innerHTML = "";
    document.getElementById("stopBtn").disabled = false;
    window.requestAnimationFrame($mod.DoNextFrame);
  };
  this.OnImageLoaded = function (Event) {
    var Result = false;
    var ImgElement = null;
    var ImgData = null;
    var i = 0;
    var p = 0;
    var Scale = 0.0;
    ImgElement = Event.target;
    Scale = $mod.MaxSize / Math.max(ImgElement.width,ImgElement.height);
    if (Scale > 1.0) Scale = 1.0;
    $mod.ImgWidth = Math.round(ImgElement.width * Scale);
    $mod.ImgHeight = Math.round(ImgElement.height * Scale);
    document.getElementById("targetCanvas").width = $mod.ImgWidth;
    document.getElementById("targetCanvas").height = $mod.ImgHeight;
    document.getElementById("reconstructCanvas").width = $mod.ImgWidth;
    document.getElementById("reconstructCanvas").height = $mod.ImgHeight;
    $mod.TargetCtx = document.getElementById("targetCanvas").getContext("2d");
    $mod.ReconstructCtx = document.getElementById("reconstructCanvas").getContext("2d");
    $mod.TargetCtx.drawImage(ImgElement,0,0,$mod.ImgWidth,$mod.ImgHeight);
    ImgData = $mod.TargetCtx.getImageData(0,0,$mod.ImgWidth,$mod.ImgHeight);
    $mod.TargetArray = rtl.arraySetLength($mod.TargetArray,$lt,$mod.ImgWidth * $mod.ImgHeight);
    $mod.CanvasArray = rtl.arraySetLength($mod.CanvasArray,$lt,$mod.ImgWidth * $mod.ImgHeight);
    p = 0;
    for (var $l = 0, $end = ($mod.ImgWidth * $mod.ImgHeight) - 1; $l <= $end; $l++) {
      i = $l;
      $mod.TargetArray[i].r = ImgData.data[p] / 255.0;
      $mod.TargetArray[i].g = ImgData.data[p + 1] / 255.0;
      $mod.TargetArray[i].b = ImgData.data[p + 2] / 255.0;
      p += 4;
    };
    $mod.InitCanvas($mod.TargetArray,{p: $mod, get: function () {
        return this.p.CanvasArray;
      }, set: function (v) {
        this.p.CanvasArray = v;
      }});
    $mod.CanvasData = $mod.ReconstructCtx.createImageData($mod.ImgWidth,$mod.ImgHeight);
    $mod.StartReconstruction();
    Result = true;
    return Result;
  };
  this.OnFileSelected = function (Event) {
    var Input = null;
    var FileObj = null;
    var Img = null;
    Input = Event.target;
    if (Input.files.length > 0) {
      FileObj = Input.files.item(0);
      Img = document.createElement("img");
      Img.onload = rtl.createSafeCallback($mod,"OnImageLoaded");
      Img.src = URL.createObjectURL(FileObj);
    };
  };
  this.OnStopClicked = function (Event) {
    var Result = false;
    $mod.StopRequested = true;
    Event.target.disabled = true;
    Result = true;
    return Result;
  };
  this.OnAnneallingStepsSliderInput = function (Event) {
    var Result = false;
    var Slider = null;
    var NewSteps = 0;
    Slider = Event.target;
    NewSteps = $lp5(Slider.value,2000);
    $mod.BaseSched.N_steps = NewSteps;
    Result = true;
    return Result;
  };
  this.OnNonImprovementSliderInput = function (Event) {
    var Result = false;
    var Slider = null;
    var NewNonImprovement = 0;
    Slider = Event.target;
    NewNonImprovement = $lp5(Slider.value,20);
    $mod.NonImprovementThreshold = NewNonImprovement;
    Result = true;
    return Result;
  };
  $mod.$main = function () {
    $mod.StopRequested = false;
    document.getElementById("imageUpload").addEventListener("change",rtl.createSafeCallback($mod,"OnFileSelected"));
    document.getElementById("annealSteps").addEventListener("input",rtl.createSafeCallback($mod,"OnAnneallingStepsSliderInput"));
    document.getElementById("nonImprovementCount").addEventListener("input",rtl.createSafeCallback($mod,"OnNonImprovementSliderInput"));
    document.getElementById("stopBtn").addEventListener("click",rtl.createSafeCallback($mod,"OnStopClicked"));
  };
});
//# sourceMappingURL=PolygonWeb.js.map
