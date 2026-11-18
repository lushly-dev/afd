/* @lushly-dev/violet-elements 0.2.0-preview.1 on @lushly-dev/fast-element 3.0.1-preview.2, bundled for the FAST-AF pages by scripts/build-site-fast-af.mjs. Do not edit. */
var Gu=Object.create;var ls=Object.defineProperty;var Yu=Object.getOwnPropertyDescriptor;var Xu=Object.getOwnPropertyNames;var Qu=Object.getPrototypeOf,Ju=Object.prototype.hasOwnProperty;var Zr=(t,e,i)=>()=>{if(i)throw i[0];try{return t&&(e=t(t=0)),e}catch(r){throw i=[r],r}};var Zu=(t,e)=>()=>{try{return e||t((e={exports:{}}).exports,e),e.exports}catch(i){throw e=0,i}},Kn=(t,e)=>{for(var i in e)ls(t,i,{get:e[i],enumerable:!0})},eh=(t,e,i,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let o of Xu(e))!Ju.call(t,o)&&o!==i&&ls(t,o,{get:()=>e[o],enumerable:!(r=Yu(e,o))||r.enumerable});return t};var th=(t,e,i)=>(i=t!=null?Gu(Qu(t)):{},eh(e||!t||!t.__esModule?ls(i,"default",{value:t,enumerable:!0}):i,t));function qv(t){let e=[],i=null;for(let r of t)if(i!==null)r===i&&(i=null);else if(r==='"'||r==="'")i=r;else if(r==="("||r==="[")e.push(r);else if(r in _u&&e.pop()!==_u[r])return!1;return i===null&&e.length===0}function Jo(t){return`--${t.replace(/\./g,"-")}`}function Cu(t){let e=[],i=t?.presets;if(typeof i!="object"||i===null||Array.isArray(i))return["the theme set has no presets object"];let r=Object.keys(i);r.length===0&&e.push("the theme set has no presets"),(typeof t.defaultPreset!="string"||!r.includes(t.defaultPreset))&&e.push(`the default preset '${String(t.defaultPreset)}' is not one of the presets (${r.join(", ")})`);for(let o of r){Nv.test(o)||e.push(`the preset name '${o}' must be letters, digits, '-' and '_', starting with a letter or digit`);let s=i[o];if(!Array.isArray(s)){e.push(`the preset '${o}' is not a list of { id, value } tokens`);continue}let n=new Set;for(let a of s){let l=a?.id;if(typeof l!="string"||!jv.test(l)){e.push(`the preset '${o}' has a token with an invalid id ${JSON.stringify(l)}`);continue}n.has(l)&&e.push(`the preset '${o}' lists '${l}' more than once`),n.add(l);let d=a.value;(typeof d!="string"||d.trim()===""||Hv.test(d)||!qv(d))&&e.push(`the preset '${o}' has an empty or unsafe value for '${l}': ${JSON.stringify(d)}`)}}return e}function ku(t){return t.map(e=>`  ${Jo(e.id)}: ${e.value};`).join(`
`)}function Kr(t){let e=Cu(t);if(e.length>0)throw new TypeError(`Invalid Violet theme set: ${e.join("; ")}`);let i=[":root,",`[${mi}]`,"{",ku(t.presets[t.defaultPreset]),"}"];for(let[r,o]of Object.entries(t.presets))r!==t.defaultPreset&&i.push(`:root[${gi}="${r}"],`,`[${mi}][${gi}="${r}"]`,"{",ku(o),"}");return i.join(`
`)}var mi,gi,Nv,jv,Hv,_u,Gr=Zr(()=>{"use strict";mi="data-violet-theme-root",gi="data-violet-theme",Nv=/^[A-Za-z0-9][A-Za-z0-9_-]*$/,jv=/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/,Hv=/[;{}<>]|\/\*|\\|[\r\n]/,_u={")":"(","]":"["}});var nr,Zo,es=Zr(()=>{"use strict";nr="light",Zo=["light","dark","high-contrast"]});var Yr,zu=Zr(()=>{"use strict";Yr={defaultPreset:"light",presets:{light:[{id:"color.action.danger.background",value:"#B42318"},{id:"color.action.danger.hover",value:"#A32015"},{id:"color.action.danger.pressed",value:"#911D12"},{id:"color.action.danger.text",value:"#FFFFFF"},{id:"color.action.primary.background",value:"#C84F3B"},{id:"color.action.primary.hover",value:"#BD4A37"},{id:"color.action.primary.pressed",value:"#B54633"},{id:"color.action.primary.text",value:"#FFFFFF"},{id:"color.action.secondary.background",value:"#F0EFE6"},{id:"color.action.secondary.border",value:"rgba(28, 26, 13, 0.18)"},{id:"color.action.secondary.hover",value:"#E7E4D8"},{id:"color.action.secondary.pressed",value:"#DDD9CB"},{id:"color.action.secondary.text",value:"#18181b"},{id:"color.border.strong",value:"rgba(28, 26, 13, 0.48)"},{id:"color.border.subtle",value:"rgba(28, 26, 13, 0.10)"},{id:"color.control.selected.background",value:"#DDEADF"},{id:"color.control.selected.border",value:"rgba(36, 70, 53, 0.22)"},{id:"color.control.selected.foreground",value:"#244635"},{id:"color.field.background",value:"#FFFEFA"},{id:"color.field.background.readonly",value:"#F0EFE6"},{id:"color.field.border",value:"rgba(28, 26, 13, 0.48)"},{id:"color.field.border.focus",value:"rgba(24, 24, 27, 0.5)"},{id:"color.field.border.hover",value:"rgba(28, 26, 13, 0.64)"},{id:"color.field.border.invalid",value:"#B42318"},{id:"color.field.placeholder",value:"#616775"},{id:"color.field.text",value:"#18181b"},{id:"color.focus.ring",value:"rgba(24, 24, 27, 0.5)"},{id:"color.state.danger.background",value:"#FBE2E2"},{id:"color.state.danger.border",value:"rgba(220, 38, 38, 0.34)"},{id:"color.state.danger.foreground",value:"#B42318"},{id:"color.state.danger.text",value:"#B42318"},{id:"color.state.success.background",value:"#E3F1E7"},{id:"color.state.success.border",value:"rgba(22, 101, 52, 0.28)"},{id:"color.state.success.foreground",value:"#245C36"},{id:"color.state.success.text",value:"#166534"},{id:"color.state.warning.background",value:"#FDEBCC"},{id:"color.state.warning.border",value:"rgba(245, 158, 11, 0.34)"},{id:"color.state.warning.text",value:"#92400E"},{id:"color.surface.card",value:"#FAF9F5"},{id:"color.surface.floating",value:"#F0EFE6"},{id:"color.surface.highlight",value:"#FFFFFF"},{id:"color.surface.page",value:"#FFFEFA"},{id:"color.surface.pressed",value:"#E7E4D8"},{id:"color.surface.selected",value:"#DDEADF"},{id:"color.surface.subtle",value:"#F0EFE6"},{id:"color.text.muted",value:"#616775"},{id:"color.text.primary",value:"#18181b"},{id:"color.text.secondary",value:"#414651"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Montserrat", "Segoe UI", sans-serif'},{id:"font.family.mono",value:'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'},{id:"radius.lg",value:"6px"},{id:"radius.md",value:"4px"},{id:"radius.round",value:"9999px"},{id:"radius.sm",value:"2px"},{id:"shadow.card",value:"0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06)"},{id:"shadow.control",value:"0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04)"},{id:"shadow.floating",value:"0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08)"},{id:"size.focus-ring.width",value:"2px"},{id:"size.font.lg",value:"18px"},{id:"size.font.md",value:"14px"},{id:"size.font.sm",value:"12px"},{id:"size.font.xl",value:"24px"},{id:"size.font.xs",value:"11px"},{id:"size.line.lg",value:"24px"},{id:"size.line.md",value:"20px"},{id:"size.line.sm",value:"16px"},{id:"size.line.xl",value:"32px"},{id:"size.line.xs",value:"14px"},{id:"size.space.lg",value:"12px"},{id:"size.space.md",value:"8px"},{id:"size.space.sm",value:"4px"},{id:"size.space.xl",value:"24px"},{id:"size.space.xs",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.lg",value:"12px"},{id:"space.inline.md",value:"8px"},{id:"space.inline.sm",value:"4px"},{id:"space.layout.md",value:"24px"},{id:"space.layout.sm",value:"12px"},{id:"space.stack.md",value:"12px"},{id:"space.stack.sm",value:"8px"},{id:"space.stack.xs",value:"4px"},{id:"type.body.md.line",value:"20px"},{id:"type.body.md.size",value:"14px"},{id:"type.body.md.weight",value:"400"},{id:"type.caption.xs.line",value:"14px"},{id:"type.caption.xs.size",value:"11px"},{id:"type.caption.xs.weight",value:"500"},{id:"type.label.sm.line",value:"16px"},{id:"type.label.sm.size",value:"12px"},{id:"type.label.sm.weight",value:"500"},{id:"type.title.md.line",value:"32px"},{id:"type.title.md.size",value:"24px"},{id:"type.title.md.weight",value:"600"},{id:"type.title.sm.line",value:"24px"},{id:"type.title.sm.size",value:"18px"},{id:"type.title.sm.weight",value:"600"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}],dark:[{id:"color.action.danger.background",value:"#B42318"},{id:"color.action.danger.hover",value:"#C4301F"},{id:"color.action.danger.pressed",value:"#CF4030"},{id:"color.action.danger.text",value:"#FFFFFF"},{id:"color.action.primary.background",value:"#C84F3B"},{id:"color.action.primary.hover",value:"#BD4A37"},{id:"color.action.primary.pressed",value:"#B54633"},{id:"color.action.primary.text",value:"#FFFFFF"},{id:"color.action.secondary.background",value:"#2B2D27"},{id:"color.action.secondary.border",value:"rgba(255, 248, 235, 0.14)"},{id:"color.action.secondary.hover",value:"#34372F"},{id:"color.action.secondary.pressed",value:"#3D4038"},{id:"color.action.secondary.text",value:"#F5EFE3"},{id:"color.border.strong",value:"rgba(255, 248, 235, 0.37)"},{id:"color.border.subtle",value:"rgba(255, 248, 235, 0.12)"},{id:"color.control.selected.background",value:"#22352C"},{id:"color.control.selected.border",value:"rgba(172, 214, 188, 0.32)"},{id:"color.control.selected.foreground",value:"#D9EFE0"},{id:"color.field.background",value:"#161713"},{id:"color.field.background.readonly",value:"#272A24"},{id:"color.field.border",value:"rgba(255, 248, 235, 0.37)"},{id:"color.field.border.focus",value:"rgba(245, 239, 227, 0.5)"},{id:"color.field.border.hover",value:"rgba(255, 248, 235, 0.52)"},{id:"color.field.border.invalid",value:"#F5C7C2"},{id:"color.field.placeholder",value:"#A39B8D"},{id:"color.field.text",value:"#F5EFE3"},{id:"color.focus.ring",value:"rgba(245, 239, 227, 0.5)"},{id:"color.state.danger.background",value:"rgba(180, 35, 24, 0.38)"},{id:"color.state.danger.border",value:"rgba(252, 165, 165, 0.24)"},{id:"color.state.danger.foreground",value:"#B42318"},{id:"color.state.danger.text",value:"#F5C7C2"},{id:"color.state.success.background",value:"rgba(22, 101, 52, 0.36)"},{id:"color.state.success.border",value:"rgba(134, 239, 172, 0.24)"},{id:"color.state.success.foreground",value:"#245C36"},{id:"color.state.success.text",value:"#B7E4C2"},{id:"color.state.warning.background",value:"rgba(146, 64, 14, 0.38)"},{id:"color.state.warning.border",value:"rgba(251, 191, 36, 0.28)"},{id:"color.state.warning.text",value:"#F3D6A3"},{id:"color.surface.card",value:"#1D1F1B"},{id:"color.surface.floating",value:"#20231D"},{id:"color.surface.highlight",value:"#FFFFFF"},{id:"color.surface.page",value:"#161713"},{id:"color.surface.pressed",value:"#E7E4D8"},{id:"color.surface.selected",value:"#22352C"},{id:"color.surface.subtle",value:"#272A24"},{id:"color.text.muted",value:"#A39B8D"},{id:"color.text.primary",value:"#F5EFE3"},{id:"color.text.secondary",value:"#D3CCBF"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Montserrat", "Segoe UI", sans-serif'},{id:"font.family.mono",value:'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'},{id:"radius.lg",value:"6px"},{id:"radius.md",value:"4px"},{id:"radius.round",value:"9999px"},{id:"radius.sm",value:"2px"},{id:"shadow.card",value:"0 2px 6px rgba(0, 0, 0, 0.28), 0 14px 32px rgba(0, 0, 0, 0.22)"},{id:"shadow.control",value:"0 1px 1px rgba(0, 0, 0, 0.24), 0 6px 16px rgba(0, 0, 0, 0.18)"},{id:"shadow.floating",value:"0 8px 18px rgba(0, 0, 0, 0.34), 0 24px 48px rgba(0, 0, 0, 0.28)"},{id:"size.focus-ring.width",value:"2px"},{id:"size.font.lg",value:"18px"},{id:"size.font.md",value:"14px"},{id:"size.font.sm",value:"12px"},{id:"size.font.xl",value:"24px"},{id:"size.font.xs",value:"11px"},{id:"size.line.lg",value:"24px"},{id:"size.line.md",value:"20px"},{id:"size.line.sm",value:"16px"},{id:"size.line.xl",value:"32px"},{id:"size.line.xs",value:"14px"},{id:"size.space.lg",value:"12px"},{id:"size.space.md",value:"8px"},{id:"size.space.sm",value:"4px"},{id:"size.space.xl",value:"24px"},{id:"size.space.xs",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.lg",value:"12px"},{id:"space.inline.md",value:"8px"},{id:"space.inline.sm",value:"4px"},{id:"space.layout.md",value:"24px"},{id:"space.layout.sm",value:"12px"},{id:"space.stack.md",value:"12px"},{id:"space.stack.sm",value:"8px"},{id:"space.stack.xs",value:"4px"},{id:"type.body.md.line",value:"20px"},{id:"type.body.md.size",value:"14px"},{id:"type.body.md.weight",value:"400"},{id:"type.caption.xs.line",value:"14px"},{id:"type.caption.xs.size",value:"11px"},{id:"type.caption.xs.weight",value:"500"},{id:"type.label.sm.line",value:"16px"},{id:"type.label.sm.size",value:"12px"},{id:"type.label.sm.weight",value:"500"},{id:"type.title.md.line",value:"32px"},{id:"type.title.md.size",value:"24px"},{id:"type.title.md.weight",value:"600"},{id:"type.title.sm.line",value:"24px"},{id:"type.title.sm.size",value:"18px"},{id:"type.title.sm.weight",value:"600"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}],"high-contrast":[{id:"color.action.danger.background",value:"#A30000"},{id:"color.action.danger.hover",value:"#8A0000"},{id:"color.action.danger.pressed",value:"#700000"},{id:"color.action.danger.text",value:"#FFFFFF"},{id:"color.action.primary.background",value:"#000000"},{id:"color.action.primary.hover",value:"#333333"},{id:"color.action.primary.pressed",value:"#4D4D4D"},{id:"color.action.primary.text",value:"#FFFFFF"},{id:"color.action.secondary.background",value:"#FFFFFF"},{id:"color.action.secondary.border",value:"#000000"},{id:"color.action.secondary.hover",value:"#E6E6E6"},{id:"color.action.secondary.pressed",value:"#CCCCCC"},{id:"color.action.secondary.text",value:"#000000"},{id:"color.border.strong",value:"#000000"},{id:"color.border.subtle",value:"#595959"},{id:"color.control.selected.background",value:"#E0E0E0"},{id:"color.control.selected.border",value:"#000000"},{id:"color.control.selected.foreground",value:"#000000"},{id:"color.field.background",value:"#FFFFFF"},{id:"color.field.background.readonly",value:"#F2F2F2"},{id:"color.field.border",value:"#595959"},{id:"color.field.border.focus",value:"#000000"},{id:"color.field.border.hover",value:"#000000"},{id:"color.field.border.invalid",value:"#A30000"},{id:"color.field.placeholder",value:"#3D3D3D"},{id:"color.field.text",value:"#000000"},{id:"color.focus.ring",value:"#000000"},{id:"color.state.danger.background",value:"#FFFFFF"},{id:"color.state.danger.border",value:"#A30000"},{id:"color.state.danger.foreground",value:"#B42318"},{id:"color.state.danger.text",value:"#A30000"},{id:"color.state.success.background",value:"#FFFFFF"},{id:"color.state.success.border",value:"#0B5A1E"},{id:"color.state.success.foreground",value:"#245C36"},{id:"color.state.success.text",value:"#0B5A1E"},{id:"color.state.warning.background",value:"#FFFFFF"},{id:"color.state.warning.border",value:"#6B3200"},{id:"color.state.warning.text",value:"#6B3200"},{id:"color.surface.card",value:"#FFFFFF"},{id:"color.surface.floating",value:"#FFFFFF"},{id:"color.surface.highlight",value:"#FFFFFF"},{id:"color.surface.page",value:"#FFFFFF"},{id:"color.surface.pressed",value:"#E7E4D8"},{id:"color.surface.selected",value:"#E0E0E0"},{id:"color.surface.subtle",value:"#F2F2F2"},{id:"color.text.muted",value:"#3D3D3D"},{id:"color.text.primary",value:"#000000"},{id:"color.text.secondary",value:"#1F1F1F"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Montserrat", "Segoe UI", sans-serif'},{id:"font.family.mono",value:'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'},{id:"radius.lg",value:"6px"},{id:"radius.md",value:"4px"},{id:"radius.round",value:"9999px"},{id:"radius.sm",value:"2px"},{id:"shadow.card",value:"0 0 0 1px #000000"},{id:"shadow.control",value:"0 0 0 1px #000000"},{id:"shadow.floating",value:"0 0 0 2px #000000"},{id:"size.focus-ring.width",value:"2px"},{id:"size.font.lg",value:"18px"},{id:"size.font.md",value:"14px"},{id:"size.font.sm",value:"12px"},{id:"size.font.xl",value:"24px"},{id:"size.font.xs",value:"11px"},{id:"size.line.lg",value:"24px"},{id:"size.line.md",value:"20px"},{id:"size.line.sm",value:"16px"},{id:"size.line.xl",value:"32px"},{id:"size.line.xs",value:"14px"},{id:"size.space.lg",value:"12px"},{id:"size.space.md",value:"8px"},{id:"size.space.sm",value:"4px"},{id:"size.space.xl",value:"24px"},{id:"size.space.xs",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.lg",value:"12px"},{id:"space.inline.md",value:"8px"},{id:"space.inline.sm",value:"4px"},{id:"space.layout.md",value:"24px"},{id:"space.layout.sm",value:"12px"},{id:"space.stack.md",value:"12px"},{id:"space.stack.sm",value:"8px"},{id:"space.stack.xs",value:"4px"},{id:"type.body.md.line",value:"20px"},{id:"type.body.md.size",value:"14px"},{id:"type.body.md.weight",value:"400"},{id:"type.caption.xs.line",value:"14px"},{id:"type.caption.xs.size",value:"11px"},{id:"type.caption.xs.weight",value:"500"},{id:"type.label.sm.line",value:"16px"},{id:"type.label.sm.size",value:"12px"},{id:"type.label.sm.weight",value:"500"},{id:"type.title.md.line",value:"32px"},{id:"type.title.md.size",value:"24px"},{id:"type.title.md.weight",value:"600"},{id:"type.title.sm.line",value:"24px"},{id:"type.title.sm.size",value:"18px"},{id:"type.title.sm.weight",value:"600"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}]}}});var Eu={};Kn(Eu,{violetThemeBuiltInSet:()=>Yr,violetThemeCssText:()=>Su,violetThemeDeclarations:()=>$u,violetThemeDeclarationsByPreset:()=>In});var Su,In,$u,An=Zr(()=>{"use strict";zu();es();Gr();Su=Kr(Yr),In=Object.fromEntries(Object.entries(Yr.presets).map(([t,e])=>[t,e.map(i=>`  ${Jo(i.id)}: ${i.value};`).join(`
`)])),$u=In[nr]});var qu=Zu(()=>{(function(){"use strict";function t(g){var y=0;return function(){return y<g.length?{done:!1,value:g[y++]}:{done:!0}}}var e=typeof Object.defineProperties=="function"?Object.defineProperty:function(g,y,C){return g==Array.prototype||g==Object.prototype||(g[y]=C.value),g};function i(g){g=[typeof globalThis=="object"&&globalThis,g,typeof window=="object"&&window,typeof self=="object"&&self,typeof global=="object"&&global];for(var y=0;y<g.length;++y){var C=g[y];if(C&&C.Math==Math)return C}throw Error("Cannot find global object")}var r=i(this);function o(g,y){if(y)e:{var C=r;g=g.split(".");for(var z=0;z<g.length-1;z++){var w=g[z];if(!(w in C))break e;C=C[w]}g=g[g.length-1],z=C[g],y=y(z),y!=z&&y!=null&&e(C,g,{configurable:!0,writable:!0,value:y})}}o("Symbol",function(g){function y(w){if(this instanceof y)throw new TypeError("Symbol is not a constructor");return new C("jscomp_symbol_"+(w||"")+"_"+z++,w)}function C(w,P){this.l=w,e(this,"description",{configurable:!0,writable:!0,value:P})}if(g)return g;C.prototype.toString=function(){return this.l};var z=0;return y}),o("Symbol.iterator",function(g){if(g)return g;g=Symbol("Symbol.iterator");for(var y="Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array".split(" "),C=0;C<y.length;C++){var z=r[y[C]];typeof z=="function"&&typeof z.prototype[g]!="function"&&e(z.prototype,g,{configurable:!0,writable:!0,value:function(){return s(t(this))}})}return g});function s(g){return g={next:g},g[Symbol.iterator]=function(){return this},g}function n(g){var y=typeof Symbol<"u"&&Symbol.iterator&&g[Symbol.iterator];return y?y.call(g):{next:t(g)}}function a(g){if(!(g instanceof Array)){g=n(g);for(var y,C=[];!(y=g.next()).done;)C.push(y.value);g=C}return g}var l=typeof Object.create=="function"?Object.create:function(g){function y(){}return y.prototype=g,new y},d=(function(){function g(){function C(){}return new C,Reflect.construct(C,[],function(){}),new C instanceof C}if(typeof Reflect<"u"&&Reflect.construct){if(g())return Reflect.construct;var y=Reflect.construct;return function(C,z,w){return C=y(C,z),w&&Reflect.setPrototypeOf(C,w.prototype),C}}return function(C,z,w){return w===void 0&&(w=C),w=l(w.prototype||Object.prototype),Function.prototype.apply.call(C,w,z)||w}})(),h;if(typeof Object.setPrototypeOf=="function")h=Object.setPrototypeOf;else{var p;e:{var x={a:!0},k={};try{k.__proto__=x,p=k.a;break e}catch{}p=!1}h=p?function(g,y){if(g.__proto__=y,g.__proto__!==y)throw new TypeError(g+" is not extensible");return g}:null}var S=h,A=window,D;if(((D=A.CustomElementRegistryPolyfill)==null?void 0:D.formAssociated)===void 0){var _={};A.CustomElementRegistryPolyfill=(_.formAssociated=new Set,_)}var T=window.HTMLElement,I=window.customElements.define,M=window.customElements.get,V=window.customElements,O=new WeakMap,j=new WeakMap,le=new WeakMap,ge=new WeakMap;function Ze(){var g;this.promise=new Promise(function(y){g=y}),this.resolve=g}function Ie(){this.h=new Map,this.m=new Map,this.j=new Map,this.i=new Map}Ie.prototype.define=function(g,y){if(g=g.toLowerCase(),this.h.get(g)!==void 0)throw new DOMException(`Failed to execute 'define' on 'CustomElementRegistry': the name "`+g+'" has already been used with this registry');if(this.m.get(y)!==void 0)throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': this constructor has already been used with this registry");var C=y.prototype.attributeChangedCallback,z=new Set(y.observedAttributes||[]);lr(y,z,C);var w=M.call(V,g),P,B,fe=(B=(P=w)==null?void 0:P.s)!=null?B:y.formAssociated||A.CustomElementRegistryPolyfill.formAssociated.has(g);if(fe&&A.CustomElementRegistryPolyfill.formAssociated.add(g),fe!=y.formAssociated)try{y.formAssociated=fe}catch{}if(C={tagName:g,g:y,connectedCallback:y.prototype.connectedCallback,disconnectedCallback:y.prototype.disconnectedCallback,adoptedCallback:y.prototype.adoptedCallback,attributeChangedCallback:C,formAssociated:fe,formAssociatedCallback:y.prototype.formAssociatedCallback,formDisabledCallback:y.prototype.formDisabledCallback,formResetCallback:y.prototype.formResetCallback,formStateRestoreCallback:y.prototype.formStateRestoreCallback,observedAttributes:z},this.h.set(g,C),this.m.set(y,C),w||(w=et(g),I.call(V,g,w)),this===window.customElements&&(le.set(y,C),C.o=w),w=this.i.get(g))for(this.i.delete(g),w=n(w),z=w.next();!z.done;z=w.next())z=z.value,j.delete(z),Nn(z,C,!0);return w=this.j.get(g),w!==void 0&&(w.resolve(y),this.j.delete(g)),y},Ie.prototype.upgrade=function(g){for(var y=[],C=0;C<arguments.length;++C)y[C]=arguments[C];Lt.push(this),V.upgrade.apply(V,a(y)),Lt.pop()},Ie.prototype.get=function(g){var y;return(y=this.h.get(g))==null?void 0:y.g},Ie.prototype.whenDefined=function(g){var y=this.h.get(g);return y!==void 0?Promise.resolve(y.g):(y=this.j.get(g),y===void 0&&(y=new Ze,this.j.set(g,y)),y.promise)};function De(g,y,C,z){var w=g.i.get(C);w||g.i.set(C,w=new Set),z?w.add(y):w.delete(y)}var Ot;window.HTMLElement=function(){var g=Ot;if(g)return Ot=void 0,g;var y=le.get(this.constructor);if(!y)throw new TypeError("Illegal constructor (custom element class must be registered with global customElements registry to be newable)");return g=Reflect.construct(T,[],y.o),Object.setPrototypeOf(g,this.constructor.prototype),O.set(g,y),g},window.HTMLElement.prototype=T.prototype;function et(g){function y(){var C=Reflect.construct(T,[],this.constructor);Object.setPrototypeOf(C,HTMLElement.prototype);e:{var z=C.getRootNode();if(!(z===document||z instanceof ShadowRoot)){if(z=Lt[Lt.length-1],z instanceof CustomElementRegistry){var w=z;break e}z=z.getRootNode(),z===document||z instanceof ShadowRoot||(z=((w=ge.get(z))==null?void 0:w.getRootNode())||document)}w=z.registry}return w=w||window.customElements,(z=w.h.get(g))?Nn(C,z):j.set(C,w),C}return r.Object.defineProperty(y,"formAssociated",{configurable:!0,enumerable:!0,get:function(){return A.CustomElementRegistryPolyfill.formAssociated.has(g)}}),y.prototype.connectedCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];Xr(this),(w=O.get(this))?w.connectedCallback&&w.connectedCallback.apply(this,z):De(j.get(this),this,g,!0)},y.prototype.disconnectedCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];(w=O.get(this))?w.disconnectedCallback&&w.disconnectedCallback.apply(this,z):De(j.get(this),this,g,!1)},y.prototype.adoptedCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];var P,B;(P=O.get(this))==null||(B=P.adoptedCallback)==null||B.apply(this,z)},y.prototype.formAssociatedCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];if(w=O.get(this),w!=null&&w.formAssociated){var P;w==null||(P=w.formAssociatedCallback)==null||P.apply(this,z)}},y.prototype.formDisabledCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];if(w=O.get(this),w!=null&&w.formAssociated){var P;w==null||(P=w.formDisabledCallback)==null||P.apply(this,z)}},y.prototype.formResetCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];if(w=O.get(this),w!=null&&w.formAssociated){var P;w==null||(P=w.formResetCallback)==null||P.apply(this,z)}},y.prototype.formStateRestoreCallback=function(C){for(var z=[],w=0;w<arguments.length;++w)z[w]=arguments[w];if(w=O.get(this),w!=null&&w.formAssociated){var P;w==null||(P=w.formStateRestoreCallback)==null||P.apply(this,z)}},y}window.CustomElementRegistry=Ie;function lr(g,y,C){if(y.size!==0&&C!==void 0){var z=g.prototype.setAttribute;z&&(g.prototype.setAttribute=function(B,fe){if(Xr(this),B=B.toLowerCase(),y.has(B)){var dr=this.getAttribute(B);z.call(this,B,fe),C.call(this,B,dr,fe)}else z.call(this,B,fe)});var w=g.prototype.removeAttribute;w&&(g.prototype.removeAttribute=function(B){if(Xr(this),B=B.toLowerCase(),y.has(B)){var fe=this.getAttribute(B);w.call(this,B),C.call(this,B,fe,null)}else w.call(this,B)});var P=g.prototype.toggleAttribute;P&&(g.prototype.toggleAttribute=function(B,fe){if(Xr(this),B=B.toLowerCase(),y.has(B)){var dr=this.getAttribute(B);P.call(this,B,fe),fe=this.getAttribute(B),dr!==fe&&C.call(this,B,dr,fe)}else P.call(this,B,fe)})}}var vi;document.readyState==="loading"&&(vi=new Set,document.addEventListener("readystatechange",function(){vi.forEach(function(g){return ns(g,O.get(g))})},{once:!0}));function Xr(g){var y;(y=vi)!=null&&y.has(g)&&ns(g,O.get(g))}function ns(g,y){var C;(C=vi)==null||C.delete(g),y.attributeChangedCallback&&y.observedAttributes.forEach(function(z){g.hasAttribute(z)&&y.attributeChangedCallback.call(g,z,null,g.getAttribute(z))})}function Bn(g){var y=Object.getPrototypeOf(g);if(y!==window.HTMLElement)return y===T?Object.setPrototypeOf(g,window.HTMLElement):Bn(y)}function Nn(g,y,C){C=C===void 0?!1:C,Object.setPrototypeOf(g,y.g.prototype),O.set(g,y),Ot=g;try{new y.g}catch{Bn(y.g),new y.g}y.attributeChangedCallback&&(vi===void 0||g.hasAttributes()?ns(g,y):vi.add(g)),C&&y.connectedCallback&&g.isConnected&&y.connectedCallback.call(g)}var jn=Element.prototype.attachShadow;Element.prototype.attachShadow=function(g,y){for(var C=[],z=1;z<arguments.length;++z)C[z-1]=arguments[z];var w=Object.assign({},g);return z=g.customElements,z=g.registry===void 0?z:g.registry,w=(delete w.customElements,delete w.registry,w),C=jn.call.apply(jn,[this,w].concat(a(C))),z!==void 0&&(C.customElements=C.registry=z),C};var Lt=[document];function Qr(g,y,C){var z=(C?Object.getPrototypeOf(C):g.prototype)[y];g.prototype[y]=function(w){for(var P=[],B=0;B<arguments.length;++B)P[B]=arguments[B];return Lt.push(this),P=z.apply(C||this,P),P!==void 0&&ge.set(P,this),Lt.pop(),P}}Qr(ShadowRoot,"createElement",document),Qr(ShadowRoot,"createElementNS",document),Qr(ShadowRoot,"importNode",document),Qr(Element,"insertAdjacentHTML");function Hn(g){var y=Object.getOwnPropertyDescriptor(g.prototype,"innerHTML");Object.defineProperty(g.prototype,"innerHTML",Object.assign({},y,{set:function(C){Lt.push(this),y.set.call(this,C),Lt.pop()}}))}if(Hn(Element),Hn(ShadowRoot),Object.defineProperty(window,"customElements",{value:new CustomElementRegistry,configurable:!0,writable:!0}),window.ElementInternals&&window.ElementInternals.prototype.setFormValue){var qn=new WeakMap,Wn=HTMLElement.prototype.attachInternals,Uu=["setFormValue","setValidity","checkValidity","reportValidity"];HTMLElement.prototype.attachInternals=function(g){for(var y=[],C=0;C<arguments.length;++C)y[C]=arguments[C];return y=Wn.call.apply(Wn,[this].concat(a(y))),qn.set(y,this),y},Uu.forEach(function(g){var y=window.ElementInternals.prototype,C=y[g];y[g]=function(z){for(var w=[],P=0;P<arguments.length;++P)w[P]=arguments[P];if(P=qn.get(this),O.get(P).formAssociated===!0)return C?.call.apply(C,[this].concat(a(w)));throw new DOMException("Failed to execute "+C+" on 'ElementInternals': The target element is not a form-associated custom element.")}});var as=function(g){var y=d(Array,[].concat(a(g)),this.constructor);return y.l=g,y},ei=as,bi=Array;if(ei.prototype=l(bi.prototype),ei.prototype.constructor=ei,S)S(ei,bi);else for(var cr in bi)if(cr!="prototype")if(Object.defineProperties){var Un=Object.getOwnPropertyDescriptor(bi,cr);Un&&Object.defineProperty(ei,cr,Un)}else ei[cr]=bi[cr];ei.u=bi.prototype,r.Object.defineProperty(as.prototype,"value",{configurable:!0,enumerable:!0,get:function(){var g;return((g=this.l.find(function(y){return y.checked===!0}))==null?void 0:g.value)||""}});var Jr=function(g){var y=this,C=new Map;g.forEach(function(z,w){var P=z.getAttribute("name"),B=C.get(P)||[];y[+w]=z,B.push(z),C.set(P,B)}),this.length=g.length,C.forEach(function(z,w){z&&w!=="length"&&w!=="item"&&w!=="namedItem"&&(y[w]=z.length===1?z[0]:new as(z))})};Jr.prototype.item=function(g){var y;return(y=this[g])!=null?y:null},Jr.prototype[Symbol.iterator]=function(){throw Error("Method not implemented.")},Jr.prototype.namedItem=function(g){var y;return(y=this[g])!=null?y:null};var Ku=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,"elements");Object.defineProperty(HTMLFormElement.prototype,"elements",{get:function(){var g=Ku.get.call(this),y=[];g=n(g);for(var C=g.next();!C.done;C=g.next()){C=C.value;var z=O.get(C);z&&z.formAssociated!==!0||y.push(C)}return new Jr(y)}})}}).call(typeof globalThis=="object"?globalThis:window)});var Gn=new WeakMap,ur=new WeakMap;function Yn(t,e){Gn.set(t,e)}function cs(t){return Gn.get(t)}function Xn(t,e,i=customElements){ur.has(i)||ur.set(i,new Map),ur.get(i).set(t,e)}function Qn(t,e=customElements){var i;return(i=ur.get(e))===null||i===void 0?void 0:i.get(t)}function Jn(t=customElements){return ur.get(t)}function Zn(t,e=customElements){let i=Qn(t,e);if(!i)return;let r=cs(i);if(r)return Object.assign(Object.assign({},r),{name:t})}function ea(t=customElements){let e=new Map,i=Jn(t);if(i)for(let[r,o]of i){let s=cs(o);s&&e.set(r,Object.assign(Object.assign({},s),{name:r}))}return e}var Y;(function(t){t[t.needsArrayObservation=1101]="needsArrayObservation",t[t.onlySetDOMPolicyOnce=1201]="onlySetDOMPolicyOnce",t[t.bindingInnerHTMLRequiresTrustedTypes=1202]="bindingInnerHTMLRequiresTrustedTypes",t[t.twoWayBindingRequiresObservables=1203]="twoWayBindingRequiresObservables",t[t.hostBindingWithoutHost=1204]="hostBindingWithoutHost",t[t.unsupportedBindingBehavior=1205]="unsupportedBindingBehavior",t[t.directCallToHTMLTagNotAllowed=1206]="directCallToHTMLTagNotAllowed",t[t.onlySetTemplatePolicyOnce=1207]="onlySetTemplatePolicyOnce",t[t.cannotSetTemplatePolicyAfterCompilation=1208]="cannotSetTemplatePolicyAfterCompilation",t[t.blockedByDOMPolicy=1209]="blockedByDOMPolicy",t[t.invalidHydrationAttributeMarker=1210]="invalidHydrationAttributeMarker",t[t.duplicateRenderInstruction=1211]="duplicateRenderInstruction",t[t.missingElementDefinition=1401]="missingElementDefinition",t[t.noRegistrationForContext=1501]="noRegistrationForContext",t[t.noFactoryForResolver=1502]="noFactoryForResolver",t[t.invalidResolverStrategy=1503]="invalidResolverStrategy",t[t.cannotAutoregisterDependency=1504]="cannotAutoregisterDependency",t[t.cannotResolveKey=1505]="cannotResolveKey",t[t.cannotConstructNativeFunction=1506]="cannotConstructNativeFunction",t[t.cannotJITRegisterNonConstructor=1507]="cannotJITRegisterNonConstructor",t[t.cannotJITRegisterIntrinsic=1508]="cannotJITRegisterIntrinsic",t[t.cannotJITRegisterInterface=1509]="cannotJITRegisterInterface",t[t.invalidResolver=1510]="invalidResolver",t[t.invalidKey=1511]="invalidKey",t[t.noDefaultResolver=1512]="noDefaultResolver",t[t.cyclicDependency=1513]="cyclicDependency",t[t.connectUpdateRequiresController=1514]="connectUpdateRequiresController"})(Y||(Y={}));var J=t=>typeof t=="function",ce=t=>typeof t=="string",ta=()=>{};var ia=Object.create(null),Z={warn(t,e){},error(t,e){return new Error(`Error ${t}`)},addMessages(t){Object.assign(ia,t)}};function ra(){return ia}var yi=Object.freeze([]);function xi(){let t=new Map;return Object.freeze({register(e){return t.has(e.type)?!1:(t.set(e.type,e),!0)},getByType(e){return t.get(e)},getForInstance(e){if(e!=null)return t.get(e.constructor)}})}function eo(){let t=new WeakMap;return function(e){let i=t.get(e);if(i===void 0){let r=Reflect.getPrototypeOf(e);for(;i===void 0&&r!==null;)i=t.get(r),r=Reflect.getPrototypeOf(r);i=i===void 0?[]:i.slice(0),t.set(e,i)}return i}}function we(t){t.prototype.toJSON=ta}var Vt=class{constructor(e,i){this.sub1=void 0,this.sub2=void 0,this.spillover=void 0,this.subject=e,this.sub1=i}has(e){return this.spillover===void 0?this.sub1===e||this.sub2===e:this.spillover.indexOf(e)!==-1}subscribe(e){let i=this.spillover;if(i===void 0){if(this.has(e))return;if(this.sub1===void 0){this.sub1=e;return}if(this.sub2===void 0){this.sub2=e;return}this.spillover=[this.sub1,this.sub2,e],this.sub1=void 0,this.sub2=void 0}else i.indexOf(e)===-1&&i.push(e)}unsubscribe(e){let i=this.spillover;if(i===void 0)this.sub1===e?this.sub1=void 0:this.sub2===e&&(this.sub2=void 0);else{let r=i.indexOf(e);r!==-1&&i.splice(r,1)}}notify(e){let i=this.spillover,r=this.subject;if(i===void 0){let o=this.sub1,s=this.sub2;o!==void 0&&o.handleChange(r,e),s!==void 0&&s.handleChange(r,e)}else for(let o=0,s=i.length;o<s;++o)i[o].handleChange(r,e)}},wi=class{constructor(e){this.subscribers={},this.subjectSubscribers=null,this.subject=e}notify(e){var i,r;(i=this.subscribers[e])===null||i===void 0||i.notify(e),(r=this.subjectSubscribers)===null||r===void 0||r.notify(e)}subscribe(e,i){var r,o;let s;i?s=(r=this.subscribers[i])!==null&&r!==void 0?r:this.subscribers[i]=new Vt(this.subject):s=(o=this.subjectSubscribers)!==null&&o!==void 0?o:this.subjectSubscribers=new Vt(this.subject),s.subscribe(e)}unsubscribe(e,i){var r,o;i?(r=this.subscribers[i])===null||r===void 0||r.unsubscribe(e):(o=this.subjectSubscribers)===null||o===void 0||o.unsubscribe(e)}};var tt=[],ds=[],ih=globalThis.requestAnimationFrame,hs=!0;function rh(){if(ds.length)throw ds.shift()}function oh(t){try{t.call()}catch(e){if(hs)ds.push(e),setTimeout(rh,0);else throw tt.length=0,e}}function us(){let e=0;for(;e<tt.length;)if(oh(tt[e]),e++,e>1024){for(let i=0,r=tt.length-e;i<r;i++)tt[i]=tt[i+e];tt.length-=e,e=0}tt.length=0}function oa(t){tt.push(t),tt.length<2&&(hs?ih(us):us())}var K=Object.freeze({enqueue:oa,next:()=>new Promise(oa),process:us,setMode:t=>hs=t});var Pt=Object.freeze({unknown:void 0,coupled:1}),R=(()=>{let t=K.enqueue,e=/(:|&&|\|\||if|\?\.)/,i=new WeakMap,r,o=d=>{throw Z.error(Y.needsArrayObservation)};function s(d){var h;let p=(h=d.$fastController)!==null&&h!==void 0?h:i.get(d);return p===void 0&&(Array.isArray(d)?p=o(d):i.set(d,p=new wi(d))),p}let n=eo();class a{constructor(h){this.name=h,this.field=`_${h}`,this.callback=`${h}Changed`}getValue(h){return r!==void 0&&r.watch(h,this.name),h[this.field]}setValue(h,p){let x=this.field,k=h[x];if(k!==p){h[x]=p;let S=h[this.callback];J(S)&&S.call(h,k,p),s(h).notify(this.name)}}}class l extends Vt{constructor(h,p,x=!1){super(h,p),this.expression=h,this.isVolatileBinding=x,this.needsRefresh=!0,this.needsQueue=!0,this.isAsync=!0,this.first=this,this.last=null,this.propertySource=void 0,this.propertyName=void 0,this.notifier=void 0,this.next=void 0}setMode(h){this.isAsync=this.needsQueue=h}bind(h){let p=this.observe(h.source,h.context);return!h.isBound&&this.requiresUnbind(h)&&h.onUnbind(this),p}requiresUnbind(h){return h.sourceLifetime!==Pt.coupled||this.first!==this.last||this.first.propertySource!==h.source}unbind(h){this.dispose()}observe(h,p){this.needsRefresh&&this.last!==null&&this.dispose();let x=r;r=this.needsRefresh?this:void 0,this.needsRefresh=this.isVolatileBinding;let k;try{k=this.expression(h,p)}finally{r=x}return k}disconnect(){this.dispose()}dispose(){if(this.last!==null){let h=this.first;for(;h!==void 0;)h.notifier.unsubscribe(this,h.propertyName),h=h.next;this.last=null,this.needsRefresh=!0,this.needsQueue=this.isAsync}}watch(h,p){let x=this.last,k=s(h),S=x===null?this.first:{};if(S.propertySource=h,S.propertyName=p,S.notifier=k,k.subscribe(this,p),x!==null){if(!this.needsRefresh){let A;r=void 0,A=x.propertySource[x.propertyName],r=this,h===A&&(this.needsRefresh=!0)}x.next=S}this.last=S}handleChange(){this.needsQueue?(this.needsQueue=!1,t(this)):this.isAsync||this.call()}call(){this.last!==null&&(this.needsQueue=this.isAsync,this.notify(this))}*records(){let h=this.first;for(;h!==void 0;)yield h,h=h.next}}return we(l),Object.freeze({setArrayObserverFactory(d){o=d},getNotifier:s,track(d,h){r&&r.watch(d,h)},trackVolatile(){r&&(r.needsRefresh=!0)},notify(d,h){s(d).notify(h)},defineProperty(d,h){ce(h)&&(h=new a(h)),n(d).push(h),Reflect.defineProperty(d,h.name,{enumerable:!0,get(){return h.getValue(this)},set(p){h.setValue(this,p)}})},getAccessors:n,binding(d,h,p=this.isVolatileBinding(d)){return new l(d,h,p)},isVolatileBinding(d){return e.test(d.toString())}})})();function m(t,e){R.defineProperty(t,e)}var sa=(()=>{let t=null;return{get(){return t},set(e){t=e}}})(),pt=Object.freeze({default:{index:0,length:0,get event(){return pt.getEvent()},eventDetail(){return this.event.detail},eventTarget(){return this.event.target}},getEvent(){return sa.get()},setEvent(t){sa.set(t)}});var ps;function na(t){return t.reduce((e,i)=>(i instanceof _e?e.push(...na(i.styles)):e.push(i),e),[])}var _e=class t{get strategy(){return this._strategy===null&&(ps||t.setDefaultStrategy(t.supportsAdoptedStyleSheets?sh():ah()),this.withStrategy(ps)),this._strategy}constructor(e){this.styles=e,this.targets=new WeakSet,this._strategy=null}addStylesTo(e){this.strategy.addStylesTo(e),this.targets.add(e)}removeStylesFrom(e){this.strategy.removeStylesFrom(e),this.targets.delete(e)}isAttachedTo(e){return this.targets.has(e)}withStrategy(e){return this._strategy=new e(na(this.styles)),this}static setDefaultStrategy(e){ps=e}static normalize(e){return e===void 0?void 0:Array.isArray(e)?new t(e):e instanceof t?e:new t([e])}};_e.supportsAdoptedStyleSheets=Array.isArray(document.adoptedStyleSheets)&&"replace"in CSSStyleSheet.prototype;function sh(){let t=new Map;return class{constructor(i){this.sheets=i.map(r=>{if(r instanceof CSSStyleSheet)return r;let o=t.get(r);return o===void 0&&(o=new CSSStyleSheet,o.replaceSync(r),t.set(r,o)),o})}addStylesTo(i){let r=i;r.adoptedStyleSheets=[...r.adoptedStyleSheets,...this.sheets]}removeStylesFrom(i){let r=i;r.adoptedStyleSheets=r.adoptedStyleSheets.filter(o=>this.sheets.indexOf(o)===-1)}}}var nh=0;function ah(){return class{constructor(e){this.styles=e,this.styleClass=`fast-${++nh}`}addStylesTo(e){let i=e===document?document.body:e;for(let r=0;r<this.styles.length;r++){let o=document.createElement("style");o.innerHTML=this.styles[r],o.className=this.styleClass,i.append(o)}}removeStylesFrom(e){let i=e===document?document.body:e,r=i.querySelectorAll(`.${this.styleClass}`);for(let o=0,s=r.length;o<s;++o)i.removeChild(r[o])}}}var W=Object.freeze({none:0,attribute:1,booleanAttribute:2,property:3,content:4,tokenList:5,event:6});var lh=/^[\u0000-\u0020\u007F]+|[\u0000-\u0020\u007F]+$/g,ch=/[\u0000-\u0020\u007F]+/g,dh=/^(?:javascript|vbscript|data):/;function fs(t){return t.replace(lh,"")}function uh(t){try{return decodeURIComponent(t)}catch{return t}}function hh(t){let e=fs(t);for(let i=0;i<3;++i){let r=uh(e);if(r===e)break;e=fs(r)}return e=e.replace(ch,"").toLowerCase(),dh.test(e)}function ph(t){let e=fs(t);return hh(e)?"":e}function ft(t,e,i,r){return(o,s,n,...a)=>{n!=null&&(n=ph(`${n}`)),r(o,s,n,...a)}}function $(t,e,i,r){throw Z.error(Y.blockedByDOMPolicy,{aspectName:i,tagName:t??"text"})}var fh={"a.href":ft,"area.href":ft,"embed.src":$,"form.action":ft,"frame.src":ft,"iframe.src":ft,"iframe.srcdoc":$,"link.href":$,"object.data":$,"script.src":$,"script.text":$},mh={"button.formaction":ft,"input.formaction":ft,"object.codebase":$},gh={"button.formAction":ft,"input.formAction":ft,"object.codeBase":$,"script.innerText":$,"script.textContent":$,"style.innerText":$,"style.textContent":$};function vh(t,e,i){var r;let o=e===W.attribute?mh:e===W.property?gh:void 0;if(o){let s=`${t}.${i}`;return(r=o[s])!==null&&r!==void 0?r:fh[s]}}var bh={onabort:$,onauxclick:$,onbeforeinput:$,onbeforematch:$,onblur:$,oncancel:$,oncanplay:$,oncanplaythrough:$,onchange:$,onclick:$,onclose:$,oncontextlost:$,oncontextmenu:$,oncontextrestored:$,oncopy:$,oncuechange:$,oncut:$,ondblclick:$,ondrag:$,ondragend:$,ondragenter:$,ondragleave:$,ondragover:$,ondragstart:$,ondrop:$,ondurationchange:$,onemptied:$,onended:$,onerror:$,onfocus:$,onformdata:$,oninput:$,oninvalid:$,onkeydown:$,onkeypress:$,onkeyup:$,onload:$,onloadeddata:$,onloadedmetadata:$,onloadstart:$,onmousedown:$,onmouseenter:$,onmouseleave:$,onmousemove:$,onmouseout:$,onmouseover:$,onmouseup:$,onpaste:$,onpause:$,onplay:$,onplaying:$,onprogress:$,onratechange:$,onreset:$,onresize:$,onscroll:$,onsecuritypolicyviolation:$,onseeked:$,onseeking:$,onselect:$,onslotchange:$,onstalled:$,onsubmit:$,onsuspend:$,ontimeupdate:$,ontoggle:$,onvolumechange:$,onwaiting:$,onwebkitanimationend:$,onwebkitanimationiteration:$,onwebkitanimationstart:$,onwebkittransitionend:$,onwheel:$};function yh(t,e){if(t===W.property&&e==="innerHTML")return $;if(t===W.attribute||t===W.property||t===W.event)return bh[e]}function aa(t,e,i,r){var o;let s=(o=vh((t??"").toLowerCase(),e,i))!==null&&o!==void 0?o:yh(e,i);return s?s(t,e,i,r):r}var la=t=>t,xh=globalThis.trustedTypes?globalThis.trustedTypes.createPolicy("fast-html",{createHTML:la}):{createHTML:la},ca=Object.freeze({createHTML(t){return xh.createHTML(t)},protect:aa}),ms=ca,mt=Object.freeze({get policy(){return ms},setPolicy(t){if(ms!==ca)throw Z.error(Y.onlySetDOMPolicyOnce);ms=t},setAttribute(t,e,i){i==null?t.removeAttribute(e):t.setAttribute(e,i)},setBooleanAttribute(t,e,i){i?t.setAttribute(e,""):t.removeAttribute(e)}});var gs="boolean",da="reflect",vs=Object.freeze({locate:eo()}),ha={toView(t){return t?"":null},fromView(t){return!!t}};function ua(t){if(t==null)return null;let e=t*1;return isNaN(e)?null:e}var to={toView(t){let e=ua(t);return e&&e.toString()},fromView:ua},hr=class t{constructor(e,i,r=i.toLowerCase(),o=da,s){this.guards=new Set,this.Owner=e,this.name=i,this.attribute=r,this.mode=o,this.converter=s,this.fieldName=`_${i}`,this.callbackName=`${i}Changed`,this.hasCallback=this.callbackName in e.prototype,o===gs&&s===void 0&&(this.converter=ha)}setValue(e,i){let r=e[this.fieldName],o=this.converter;o!==void 0&&(i=o.fromView(i)),r!==i&&(e[this.fieldName]=i,this.tryReflectToAttribute(e),this.hasCallback&&e[this.callbackName](r,i),e.$fastController.notify(this.name))}getValue(e){return R.track(e,this.name),e[this.fieldName]}onAttributeChangedCallback(e,i){this.guards.has(e)||(this.guards.add(e),this.mode===gs?this.setValue(e,i!==null):this.setValue(e,i),this.guards.delete(e))}tryReflectToAttribute(e){let i=this.mode,r=this.guards;r.has(e)||i==="fromView"||K.enqueue(()=>{r.add(e);let o=e[this.fieldName];switch(i){case da:{let s=this.converter;mt.setAttribute(e,this.attribute,s!==void 0?s.toView(o):o);break}case gs:mt.setBooleanAttribute(e,this.attribute,o);break}r.delete(e)})}static collect(e,...i){let r=[];i.push(vs.locate(e));for(let o=0,s=i.length;o<s;++o){let n=i[o];if(n!==void 0)for(let a=0,l=n.length;a<l;++a){let d=n[a];ce(d)?r.push(new t(e,d)):r.push(new t(e,d.property,d.attribute,d.mode,d.converter))}}return r}};function c(t,e){let i;function r(o,s){arguments.length>1&&(i.property=s),vs.locate(o.constructor).push(i)}if(arguments.length>1){i={},r(t,e);return}return i=t===void 0?{}:t,r}var bs={define(t,e,i,r,o){r.define(t,e,i)}};var wh={},pa=new WeakMap,ys=xi(),io=new WeakMap,fa=new WeakMap,_i=Object.freeze({register(t){if(!ys.register(t))return!1;let e=ga(t.registry);return Object.prototype.hasOwnProperty.call(e,t.name)||R.defineProperty(e,t.name),e[t.name]=t.type,!0},getByType:ys.getByType,getForInstance:ys.getForInstance,whenRegistered:_h});function ga(t=customElements){if(t===customElements)return wh;let e=pa.get(t);return e||(e={},pa.set(t,e)),e}function ma(t){return t===void 0?void 0:_i.getByType(t)}function _h(t,e=customElements){let i=ga(e);Object.prototype.hasOwnProperty.call(i,t)||R.defineProperty(i,t);let r=ma(i[t]);return r!==void 0?Promise.resolve(r):new Promise(o=>{let s=R.getNotifier(i),n={handleChange:()=>{let a=ma(i[t]);a!==void 0&&(s.unsubscribe(n,t),o(a))}};s.subscribe(n,t)})}function va(t,e){if(fa.has(e))return!1;let i=io.get(t),r=i===void 0;i===void 0&&(i=new Set,io.set(t,i));let o=new WeakRef(e);return i.add(o),fa.set(e,o),r}function ba(t,e){let i=io.get(t);if(i!==void 0){io.delete(t);for(let r of i){let o=r.deref();o!==void 0&&e(o)}}}var kh={mode:"open"},ya={},xa=new Set;function Ch(t){if(t===null)return;let e=Object.assign(Object.assign({},kh),t);return e.customElementRegistry===void 0&&e.registry!==void 0&&(e.customElementRegistry=e.registry),e.registry===void 0&&e.customElementRegistry!==void 0&&(e.registry=e.customElementRegistry),e}var oo=new WeakMap,ro=new WeakMap,ti=new WeakMap,wa=new WeakMap,pr=new Set,zh=new WeakMap;function Sh(t){return J(t)}function $h(t){return typeof t?.then=="function"}function _a(t,e){if(ro.delete(t),t.template===void 0&&e!==void 0&&(t.template=e),t.template!==void 0)return ti.delete(t),oo.delete(t),t.template}function xs(t,e=t.registry,i){if(pr.size===0&&!i?.length)return;let r=t,o=wa.get(r);if(!o?.has(e)){o===void 0&&(o=new WeakSet,wa.set(r,o)),o.add(e);for(let s of pr)s(t,e);for(let s of i??[])pr.has(s)||s(t,e)}}function ka(t){return pr.add(t),()=>{pr.delete(t)}}function so(t){var e;return(e=zh.get(t))!==null&&e!==void 0?e:null}function ws(t){if(t.template!==void 0)return ti.delete(t),t.template;let e=ro.get(t);if(e)return e;let i=oo.get(t);if(!i)return;ti.delete(t);let r;try{r=i(t)}catch(o){throw ti.set(t,o),o}if($h(r)){let o=Promise.resolve(r).then(s=>_a(t,s)).catch(s=>{throw ro.delete(t),ti.set(t,s),s});return ro.set(t,o),o}return _a(t,r)}function Eh(t,e){let i=t;if(e===void 0){ti.delete(i);return}ti.set(i,e)}var ve=class t{get isDefined(){return this.platformDefined}constructor(e,i=e.definition){var r;this.platformDefined=!1,ce(i)&&(i={name:i}),this.type=e,this.name=i.name,this.registry=(r=i.registry)!==null&&r!==void 0?r:customElements,Sh(i.template)?oo.set(this,i.template):this.template=i.template;let o=e.prototype,s=hr.collect(e,i.attributes),n=new Array(s.length),a={},l={};for(let d=0,h=s.length;d<h;++d){let p=s[d];n[d]=p.attribute,a[p.name]=p,l[p.attribute]=p,R.defineProperty(o,p)}Reflect.defineProperty(e,"observedAttributes",{value:n,enumerable:!0}),this.attributes=s,this.propertyLookup=a,this.attributeLookup=l,this.shadowOptions=Ch(i.shadowOptions),this.elementOptions=i.elementOptions===void 0?ya:Object.assign(Object.assign({},ya),i.elementOptions),this.styles=_e.normalize(i.styles),this.schema=i.schema,_i.register(this)}define(e=this.registry,i){let r=this.type;if(!e.get(this.name)){if(xs(this,e,i),this.template===void 0&&oo.has(this))return Promise.resolve().then(()=>ws(this)).then(s=>{if(s!==void 0&&!e.get(this.name)){let n=this.platformDefined;this.platformDefined=!0,bs.define(this.name,r,this.elementOptions,e,n)}}).catch(s=>{Eh(this,s),R.notify(this,"template")}),this;let o=this.platformDefined;this.platformDefined=!0,bs.define(this.name,r,this.elementOptions,e,o)}return this}static compose(e,i){let r=xa.has(e)||_i.getByType(e)?new t(class extends e{},i):new t(e,i);return Promise.resolve(r)}static registerBaseType(e){xa.add(e)}};ve.getByType=_i.getByType;ve.getForInstance=_i.getForInstance;R.defineProperty(ve.prototype,"template");function Th(t){return t==="boolean"?"boolean":"string"}function Ih(t){let e=[],i=t.attributes;for(let r of i){let o={name:r.name,type:Th(r.mode),attribute:r.attribute};e.push(o)}return e}function Ah(t){var e,i;if(typeof document>"u"||!t)return[];let r=[];try{let o=document.createElement("div"),s=t.create(o);s.appendTo(o);for(let n of Array.from(o.querySelectorAll("slot"))){let a=(e=n.getAttribute("name"))!==null&&e!==void 0?e:"",l=(i=n.getAttribute("data-description"))!==null&&i!==void 0?i:void 0;r.push({name:a,description:l})}s.dispose()}catch{return[]}return r}var Ca=/(--[\w-]+):\s*([^;]+)/g;function Rh(t){if(!t)return[];let e=[],i=new Set;for(let r of t.styles){let o;if(typeof r=="string")o=r;else if(typeof CSSStyleSheet<"u"&&r instanceof CSSStyleSheet)try{let s=r.cssRules,n=[];for(let a=0;a<s.length;a++)n.push(s[a].cssText);o=n.join(`
`)}catch{continue}if(o){let s;for(Ca.lastIndex=0;(s=Ca.exec(o))!==null;){let n=s[1],a=s[2].trim();i.has(n)||(i.add(n),e.push({name:n,default:a}))}}}return e}function za(t){let e=Ih(t),i=Ah(t.template),r=Rh(t.styles);return{name:t.name,version:void 0,description:void 0,properties:e,events:[],slots:i,cssProperties:r}}var _s=new WeakMap;function Sa(t,e){Yn(t.type,za(t)),Xn(t.name,t.type,e)}var Fh=(t,e)=>{if(Sa(t,e),t.template!==void 0||_s.has(t))return;let i=R.getNotifier(t),r={handleChange(){t.template!==void 0&&(Sa(t,e),i.unsubscribe(r,"template"),_s.delete(t))}};_s.set(t,r),i.subscribe(r,"template")},ki;function ks(){return ki===void 0&&(ki=ka(Fh)),$a}function $a(){ki?.(),ki=void 0}ks();var As={};Kn(As,{registerSystemArrowUpIcon:()=>Cs,registerSystemAttachIcon:()=>fr,registerSystemCalendarIcon:()=>mr,registerSystemCheckmarkIcon:()=>gt,registerSystemChevronRightIcon:()=>Be,registerSystemClockIcon:()=>zs,registerSystemCloseIcon:()=>Ne,registerSystemDismissIcon:()=>Ae,registerSystemDocumentIcon:()=>vt,registerSystemFolderIcon:()=>Ss,registerSystemSearchIcon:()=>Mh,registerSystemSettingsIcon:()=>$s,registerSystemSortAscendingIcon:()=>Es,registerSystemSortDescendingIcon:()=>Ts,registerSystemStopIcon:()=>Is,registerSystemWarningIcon:()=>ii,systemArrowUpIcon:()=>Aa,systemAttachIcon:()=>Ra,systemCalendarIcon:()=>Fa,systemCheckmarkIcon:()=>Da,systemChevronRightIcon:()=>Ma,systemClockIcon:()=>Oa,systemCloseIcon:()=>La,systemDismissIcon:()=>Va,systemDocumentIcon:()=>Pa,systemFolderIcon:()=>Ba,systemSearchIcon:()=>Na,systemSettingsIcon:()=>ja,systemSortAscendingIcon:()=>Ha,systemSortDescendingIcon:()=>qa,systemStopIcon:()=>Wa,systemWarningIcon:()=>Ua,violetIconSources:()=>Dh});var Dh=[{id:"system",title:"Violet System Seed Icons",license:"MIT",attribution:"Lushly Dev",homepage:"",notes:"Small hand-authored seed set used to validate the internal FAST-AF icon workflow."}];var Ea=new Map;function H(t){return Ea.set(t.name,t),t}function Ta(t){return t.forEach(H),t}function Ia(t){return Ea.get(t)??null}var Aa={name:"system/arrow-up",sourceId:"system",originalFile:"arrow-up.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 19V5"/><path d="M5 12L12 5L19 12"/></svg>'};function Cs(){return H(Aa)}var Ra={name:"system/attach",sourceId:"system",originalFile:"attach.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M21.44 11.05L12.25 20.24A5.37 5.37 0 0 1 4.63 12.62L13.82 3.44A3.58 3.58 0 0 1 18.88 8.5L9.69 17.69A1.79 1.79 0 0 1 7.16 15.16L15.64 6.68"/></svg>'};function fr(){return H(Ra)}var Fa={name:"system/calendar",sourceId:"system",originalFile:"calendar.svg",svg:'<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3h.25A1.75 1.75 0 0 1 14 4.75v7.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-7.5A1.75 1.75 0 0 1 3.75 3H4V1.75Z" stroke="currentColor" stroke-width="1.25"/><path d="M2.625 6.25h10.75" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M5.25 8.5h1.5M9.25 8.5h1.5M5.25 11h1.5M9.25 11h1.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>'};function mr(){return H(Fa)}var Da={name:"system/checkmark",sourceId:"system",originalFile:"checkmark.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M5 12L10 17L20 7"/></svg>'};function gt(){return H(Da)}var Ma={name:"system/chevron-right",sourceId:"system",originalFile:"chevron-right.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M9 6L15 12L9 18"/></svg>'};function Be(){return H(Ma)}var Oa={name:"system/clock",sourceId:"system",originalFile:"clock.svg",svg:'<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5.375" stroke="currentColor" stroke-width="1.25"/><path d="M8 4.75V8L10.25 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>'};function zs(){return H(Oa)}var La={name:"system/close",sourceId:"system",originalFile:"close.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18"/><path d="M18 6L6 18"/></svg>'};function Ne(){return H(La)}var Va={name:"system/dismiss",sourceId:"system",originalFile:"dismiss.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18"/><path d="M18 6L6 18"/></svg>'};function Ae(){return H(Va)}var Pa={name:"system/document",sourceId:"system",originalFile:"document.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6A2 2 0 0 0 4 4V20A2 2 0 0 0 6 22H18A2 2 0 0 0 20 20V8Z"/><polyline points="14 2 14 8 20 8"/></svg>'};function vt(){return H(Pa)}var Ba={name:"system/folder",sourceId:"system",originalFile:"folder.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 6A2 2 0 0 1 5 4H9L11 6H19A2 2 0 0 1 21 8V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18Z"/></svg>'};function Ss(){return H(Ba)}var Na={name:"system/search",sourceId:"system",originalFile:"search.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="6"/><path d="M20 20L16.2 16.2"/></svg>'};function Mh(){return H(Na)}var ja={name:"system/settings",sourceId:"system",originalFile:"settings.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3"/><path d="M19.4 15A1.7 1.7 0 0 0 19.7 16.9L19.8 17A2 2 0 1 1 17 19.8L16.9 19.7A1.7 1.7 0 0 0 15 19.4A1.7 1.7 0 0 0 14 21V21.3A2 2 0 1 1 10 21.3V21A1.7 1.7 0 0 0 9 19.4A1.7 1.7 0 0 0 7.1 19.7L7 19.8A2 2 0 1 1 4.2 17L4.3 16.9A1.7 1.7 0 0 0 4.6 15A1.7 1.7 0 0 0 3 14H2.7A2 2 0 1 1 2.7 10H3A1.7 1.7 0 0 0 4.6 9A1.7 1.7 0 0 0 4.3 7.1L4.2 7A2 2 0 1 1 7 4.2L7.1 4.3A1.7 1.7 0 0 0 9 4.6H9.1A1.7 1.7 0 0 0 10 3V2.7A2 2 0 1 1 14 2.7V3A1.7 1.7 0 0 0 15 4.6A1.7 1.7 0 0 0 16.9 4.3L17 4.2A2 2 0 1 1 19.8 7L19.7 7.1A1.7 1.7 0 0 0 19.4 9V9.1A1.7 1.7 0 0 0 21 10H21.3A2 2 0 1 1 21.3 14H21A1.7 1.7 0 0 0 19.4 15Z"/></svg>'};function $s(){return H(ja)}var Ha={name:"system/sort-ascending",sourceId:"system",originalFile:"sort-ascending.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 18V6"/><path d="M7 11L12 6L17 11"/></svg>'};function Es(){return H(Ha)}var qa={name:"system/sort-descending",sourceId:"system",originalFile:"sort-descending.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M12 6V18"/><path d="M7 13L12 18L17 13"/></svg>'};function Ts(){return H(qa)}var Wa={name:"system/stop",sourceId:"system",originalFile:"stop.svg",svg:'<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'};function Is(){return H(Wa)}var Ua={name:"system/warning",sourceId:"system",originalFile:"warning.svg",svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18A2 2 0 0 0 3.54 21H20.46A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'};function ii(){return H(Ua)}Ta(Object.values(As).filter(t=>typeof t?.svg=="string"));var Me=class{constructor(e,i,r=!1){this.evaluate=e,this.policy=i,this.isVolatile=r}};var no=class extends Me{createObserver(){return this}bind(e){return this.evaluate(e.source,e.context)}};we(no);function je(t,e){return new no(t,e)}var Rs=class extends Me{createObserver(e){return R.binding(this.evaluate,e,this.isVolatile)}};function Bt(t,e,i=R.isVolatileBinding(t)){return new Rs(t,e,i)}function gr(t){return J(t)?Bt(t):t instanceof Me?t:je(()=>t)}var Oh={bubbles:!0,composed:!0,cancelable:!0},Fs="isConnected",Ya=new WeakMap,Ds=Symbol("fast-late-attribute-observer");function ao(t){var e,i;return(i=(e=t.shadowRoot)!==null&&e!==void 0?e:Ya.get(t))!==null&&i!==void 0?i:null}var Ka,ke;(function(t){t[t.connecting=0]="connecting",t[t.connected=1]="connected",t[t.disconnecting=2]="disconnecting",t[t.disconnected=3]="disconnected"})(ke||(ke={}));var Nt=class t{get isConnected(){return R.track(this,Fs),this.stage===ke.connected}get context(){var e,i;return(i=(e=this.view)===null||e===void 0?void 0:e.context)!==null&&i!==void 0?i:pt.default}get isBound(){var e,i;return(i=(e=this.view)===null||e===void 0?void 0:e.isBound)!==null&&i!==void 0?i:!1}get sourceLifetime(){var e;return(e=this.view)===null||e===void 0?void 0:e.sourceLifetime}get template(){var e;if(this._template===null){let i=this.definition;this.source.resolveTemplate?this._template=this.source.resolveTemplate():i.template&&(this._template=(e=i.template)!==null&&e!==void 0?e:null)}return this._template}set template(e){this._template!==e&&(this._template=e,this.needsInitialization||this.renderTemplate(e))}get shadowOptions(){return this._shadowRootOptions}set shadowOptions(e){if(this._shadowRootOptions===void 0&&e!==void 0){this._shadowRootOptions=e;let i=this.source.shadowRoot;i?(this.hasExistingShadowRoot=!0,Lh(i,e)):(i=this.source.attachShadow(e),e.mode==="closed"&&Ya.set(this.source,i))}}get mainStyles(){var e;if(this._mainStyles===null){let i=this.definition;this.source.resolveStyles?this._mainStyles=this.source.resolveStyles():i.styles&&(this._mainStyles=(e=i.styles)!==null&&e!==void 0?e:null)}return this._mainStyles}set mainStyles(e){this._mainStyles!==e&&(this._mainStyles!==null&&this.removeStyles(this._mainStyles),this._mainStyles=e,this.needsInitialization||this.addStyles(e))}constructor(e,i){this.boundObservables=null,this.needsInitialization=!0,this.hasExistingShadowRoot=!1,this.isPrerendered=new Promise(s=>{this._resolvePrerendered=s}),this.isHydrated=new Promise(s=>{this._resolveHydrated=s}),this._template=null,this.stage=ke.disconnected,this.guardBehaviorConnection=!1,this.behaviors=null,this.behaviorsConnected=!1,this._mainStyles=null,this.$fastController=this,this.view=null,this._notifier=new wi(e),this.source=e,this.definition=i,this.shadowOptions=i.shadowOptions;let r=Reflect.getPrototypeOf(e),o=r===null?[]:R.getAccessors(r);if(o.length>0){let s=this.boundObservables=Object.create(null);for(let n=0,a=o.length;n<a;++n){let l=o[n].name,d=e[l];d!==void 0&&(delete e[l],s[l]=d)}Object.keys(s).length===0&&(this.boundObservables=null)}this.captureBoundObservables()}get subject(){return this._notifier.subject}notify(e){this._notifier.notify(e)}subscribe(e,i){this._notifier.subscribe(e,i)}unsubscribe(e,i){this._notifier.unsubscribe(e,i)}onUnbind(e){var i;(i=this.view)===null||i===void 0||i.onUnbind(e)}addBehavior(e){var i,r;let o=(i=this.behaviors)!==null&&i!==void 0?i:this.behaviors=new Map,s=(r=o.get(e))!==null&&r!==void 0?r:0;s===0?(o.set(e,1),e.addedCallback&&e.addedCallback(this),e.connectedCallback&&!this.guardBehaviorConnection&&(this.stage===ke.connected||this.stage===ke.connecting)&&e.connectedCallback(this)):o.set(e,s+1)}removeBehavior(e,i=!1){let r=this.behaviors;if(r===null)return;let o=r.get(e);o!==void 0&&(o===1||i?(r.delete(e),e.disconnectedCallback&&this.stage!==ke.disconnected&&e.disconnectedCallback(this),e.removedCallback&&e.removedCallback(this)):r.set(e,o-1))}addStyles(e){var i;if(!e)return;let r=this.source;e instanceof HTMLElement?((i=ao(r))!==null&&i!==void 0?i:this.source).append(e):e.isAttachedTo(r)||e.addStylesTo(r)}removeStyles(e){var i;if(!e)return;let r=this.source;e instanceof HTMLElement?((i=ao(r))!==null&&i!==void 0?i:r).removeChild(e):e.isAttachedTo(r)&&e.removeStylesFrom(r)}connect(){this.stage===ke.disconnected&&(this.stage=ke.connecting,this.captureBoundObservables(),this.syncLateAttributes(),this.observeLateAttributes(),this.bindObservables(),this.connectBehaviors(),this.needsInitialization?(this.renderTemplate(this.template),this.addStyles(this.mainStyles),this.needsInitialization=!1):this.view!==null&&this.view.bind(this.source),this.stage=ke.connected,R.notify(this,Fs))}bindObservables(){if(this.boundObservables!==null){let e=this.source,i=this.boundObservables,r=Object.keys(i);for(let o=0,s=r.length;o<s;++o){let n=r[o];e[n]=i[n]}this.boundObservables=null}}captureBoundObservables(){let e=this.source,i=Object.getOwnPropertyNames(e),r=s=>{let n=Reflect.getPrototypeOf(e);for(;n!==null;){let a=Reflect.getOwnPropertyDescriptor(n,s);if(a?.get||a?.set)return!0;n=Reflect.getPrototypeOf(n)}return!1},o=this.boundObservables;for(let s=0,n=i.length;s<n;++s){let l=i[s];if(!r(l))continue;let d=e[l];if(d===void 0){delete e[l];continue}delete e[l],(o??(o=this.boundObservables=Object.create(null)))[l]=d}}syncLateAttributes(){let e=so(this.definition);if(e!==null)for(let i of Object.keys(e))this.source.hasAttribute(i)&&this.onAttributeChangedCallback(i,null,this.source.getAttribute(i))}observeLateAttributes(){let e=so(this.definition);if(e===null)return;let i=this.source;i[Ds]===void 0&&(i[Ds]=new MutationObserver(r=>{let o=i.$fastController,s=so(o.definition);if(s!==null)for(let n=0,a=r.length;n<a;++n){let l=r[n].attributeName;l===null||s[l]===void 0||o.onAttributeChangedCallback(l,null,i.getAttribute(l))}}),i[Ds].observe(i,{attributes:!0,attributeFilter:Object.keys(e)}))}connectBehaviors(){if(this.behaviorsConnected===!1){let e=this.behaviors;if(e!==null){this.guardBehaviorConnection=!0;for(let i of e.keys())i.connectedCallback&&i.connectedCallback(this);this.guardBehaviorConnection=!1}this.behaviorsConnected=!0}}disconnectBehaviors(){if(this.behaviorsConnected===!0){let e=this.behaviors;if(e!==null)for(let i of e.keys())i.disconnectedCallback&&i.disconnectedCallback(this);this.behaviorsConnected=!1}}disconnect(){this.stage===ke.connected&&(this.stage=ke.disconnecting,R.notify(this,Fs),this.view!==null&&this.view.unbind(),this.disconnectBehaviors(),this.stage=ke.disconnected)}onAttributeChangedCallback(e,i,r){let o=this.definition.attributeLookup[e];o!==void 0&&o.onAttributeChangedCallback(this.source,r)}emit(e,i,r){return this.stage===ke.connected?this.source.dispatchEvent(new CustomEvent(e,Object.assign(Object.assign({detail:i},Oh),r))):!1}renderTemplate(e){var i;let r=this.source,o=(i=ao(r))!==null&&i!==void 0?i:r;if(this.view!==null)this.view.dispose(),this.view=null;else if((!this.needsInitialization||this.hasExistingShadowRoot)&&(!this.hasExistingShadowRoot||!this.needsInitialization))for(let s=o.firstChild;s!==null;s=o.firstChild)o.removeChild(s);if(e){let s=this.hasExistingShadowRoot&&this.needsInitialization,n=!1;s&&t.hydrationHook&&(n=t.hydrationHook(this,e,r,o)),n||this.renderClientSide(e,r,o),this._resolvePrerendered(s),this._resolveHydrated(n)}else this.needsInitialization&&(this._resolvePrerendered(!1),this._resolveHydrated(!1))}renderClientSide(e,i,r){var o;if(this.hasExistingShadowRoot){for(let n=r.firstChild;n!==null;n=r.firstChild)r.removeChild(n);this.hasExistingShadowRoot=!1}let s=((o=this._shadowRootOptions)===null||o===void 0?void 0:o.customElementRegistry)!==void 0?r:void 0;this.view=e.render(i,r,i,s),this.view.sourceLifetime=Pt.coupled}static forCustomElement(e,i=!1){let r=e.$fastController;if(r!==void 0&&!i)return r;let o=ve.getForInstance(e);if(o===void 0)throw Z.error(Y.missingElementDefinition);if(o.template===void 0&&va(o,e)){let s=R.getNotifier(o),n={handleChange:()=>{s.unsubscribe(n,"template"),ba(o,a=>{var l;let d=a;(l=d.$fastController)===null||l===void 0||l.disconnect(),t.forCustomElement(d,!0),d.isConnected&&d.$fastController.connect()})}};s.subscribe(n,"template")}return e.$fastController=new Ka(e,o)}static setStrategy(e){Ka=e}static installHydrationHook(e){t.hydrationHook=e}};Nt.hydrationHook=null;we(Nt);function Lh(t,e){let i=e.customElementRegistry;i!=null&&t.customElementRegistry===null&&typeof i.initialize=="function"&&i.initialize(t)}Nt.setStrategy(Nt);function lo(t){var e;return"adoptedStyleSheets"in t?t:(e=ao(t))!==null&&e!==void 0?e:t.getRootNode()}var co=class t{constructor(e){let i=t.styleSheetCache;this.sheets=e.map(r=>{if(r instanceof CSSStyleSheet)return r;let o=i.get(r);return o===void 0&&(o=new CSSStyleSheet,o.replaceSync(r),i.set(r,o)),o})}addStylesTo(e){Xa(lo(e),this.sheets)}removeStylesFrom(e){Qa(lo(e),this.sheets)}};co.styleSheetCache=new Map;var Vh=0,Ph=()=>`fast-${++Vh}`;function Ga(t){return t===document?document.body:t}var Ms=class{constructor(e){this.styles=e,this.styleClass=Ph()}addStylesTo(e){e=Ga(lo(e));let i=this.styles,r=this.styleClass;for(let o=0;o<i.length;o++){let s=document.createElement("style");s.innerHTML=i[o],s.className=r,e.append(s)}}removeStylesFrom(e){e=Ga(lo(e));let i=e.querySelectorAll(`.${this.styleClass}`);for(let r=0,o=i.length;r<o;++r)e.removeChild(i[r])}},Xa=(t,e)=>{t.adoptedStyleSheets=[...t.adoptedStyleSheets,...e]},Qa=(t,e)=>{t.adoptedStyleSheets=t.adoptedStyleSheets.filter(i=>e.indexOf(i)===-1)};if(_e.supportsAdoptedStyleSheets){try{document.adoptedStyleSheets.push(),document.adoptedStyleSheets.splice(),Xa=(t,e)=>{t.adoptedStyleSheets.push(...e)},Qa=(t,e)=>{for(let i of e){let r=t.adoptedStyleSheets.indexOf(i);r!==-1&&t.adoptedStyleSheets.splice(r,1)}}}catch{}_e.setDefaultStrategy(co)}else _e.setDefaultStrategy(Ms);function Ja(t){let e=class extends t{constructor(){super(),Nt.forCustomElement(this)}$emit(i,r,o){return this.$fastController.emit(i,r,o)}connectedCallback(){this.$fastController.connect()}disconnectedCallback(){this.$fastController.disconnect()}attributeChangedCallback(i,r,o){this.$fastController.onAttributeChangedCallback(i,r,o)}};return ve.registerBaseType(e),e}function Bh(t){return typeof t?.then=="function"}function Nh(t,e,i){return Array.isArray(e)&&(i=e,e=void 0),(J(t)?ve.compose(t,e):ve.compose(this,t)).then(o=>{xs(o,o.registry,i);let s=ws(o);return Bh(s)?s.then(()=>o.define().type):o.define().type})}function jh(t){return Ja(t)}var f=Object.assign(Ja(HTMLElement),{from:jh,define:Nh});var Re=class{constructor(e,i,r){this.index=e,this.removed=i,this.addedCount=r}adjustTo(e){let i=this.index,r=e.length;return i>r?i=r-this.addedCount:i<0&&(i=r+this.removed.length+i-this.addedCount),this.index=i<0?0:i,this}},uo=class{constructor(e){this.sorted=e}},Hh=Object.freeze({reset:1,splice:2,optimized:3}),el=new Re(0,yi,0);el.reset=!0;var Vs=[el],Oe;(function(t){t[t.leave=0]="leave",t[t.update=1]="update",t[t.add=2]="add",t[t.delete=3]="delete"})(Oe||(Oe={}));function qh(t,e,i,r,o,s){let n=s-o+1,a=i-e+1,l=new Array(n),d,h;for(let p=0;p<n;++p)l[p]=new Array(a),l[p][0]=p;for(let p=0;p<a;++p)l[0][p]=p;for(let p=1;p<n;++p)for(let x=1;x<a;++x)t[e+x-1]===r[o+p-1]?l[p][x]=l[p-1][x-1]:(d=l[p-1][x]+1,h=l[p][x-1]+1,l[p][x]=d<h?d:h);return l}function Wh(t){let e=t.length-1,i=t[0].length-1,r=t[e][i],o=[];for(;e>0||i>0;){if(e===0){o.push(Oe.add),i--;continue}if(i===0){o.push(Oe.delete),e--;continue}let s=t[e-1][i-1],n=t[e-1][i],a=t[e][i-1],l;n<a?l=n<s?n:s:l=a<s?a:s,l===s?(s===r?o.push(Oe.leave):(o.push(Oe.update),r=s),e--,i--):l===n?(o.push(Oe.delete),e--,r=n):(o.push(Oe.add),i--,r=a)}return o.reverse()}function Uh(t,e,i){for(let r=0;r<i;++r)if(t[r]!==e[r])return r;return i}function Kh(t,e,i){let r=t.length,o=e.length,s=0;for(;s<i&&t[--r]===e[--o];)s++;return s}function Gh(t,e,i,r){return e<i||r<t?-1:e===i||r===t?0:t<i?e<r?e-i:r-i:r<e?r-t:e-t}function Yh(t,e,i,r,o,s){let n=0,a=0,l=Math.min(i-e,s-o);if(e===0&&o===0&&(n=Uh(t,r,l)),i===t.length&&s===r.length&&(a=Kh(t,r,l-n)),e+=n,o+=n,i-=a,s-=a,i-e===0&&s-o===0)return yi;if(e===i){let S=new Re(e,[],0);for(;o<s;)S.removed.push(r[o++]);return[S]}else if(o===s)return[new Re(e,[],i-e)];let d=Wh(qh(t,e,i,r,o,s)),h=[],p,x=e,k=o;for(let S=0;S<d.length;++S)switch(d[S]){case Oe.leave:p!==void 0&&(h.push(p),p=void 0),x++,k++;break;case Oe.update:p===void 0&&(p=new Re(x,[],0)),p.addedCount++,x++,p.removed.push(r[k]),k++;break;case Oe.add:p===void 0&&(p=new Re(x,[],0)),p.addedCount++,x++;break;case Oe.delete:p===void 0&&(p=new Re(x,[],0)),p.removed.push(r[k]),k++;break}return p!==void 0&&h.push(p),h}function Xh(t,e){let i=!1,r=0;for(let o=0;o<e.length;o++){let s=e[o];if(s.index+=r,i)continue;let n=Gh(t.index,t.index+t.removed.length,s.index,s.index+s.addedCount);if(n>=0){e.splice(o,1),o--,r-=s.addedCount-s.removed.length,t.addedCount+=s.addedCount-n;let a=t.removed.length+s.removed.length-n;if(!t.addedCount&&!a)i=!0;else{let l=s.removed;if(t.index<s.index){let d=t.removed.slice(0,s.index-t.index);d.push(...l),l=d}if(t.index+t.removed.length>s.index+s.addedCount){let d=t.removed.slice(s.index+s.addedCount-t.index);l.push(...d)}t.removed=l,s.index<t.index&&(t.index=s.index)}}else if(t.index<s.index){i=!0,e.splice(o,0,t),o++;let a=t.addedCount-t.removed.length;s.index+=a,r+=a}}i||e.push(t)}function Qh(t,e){let i=[],r=[];for(let o=0,s=e.length;o<s;o++)Xh(e[o],r);for(let o=0,s=r.length;o<s;++o){let n=r[o];if(n.addedCount===1&&n.removed.length===1){n.removed[0]!==t[n.index]&&i.push(n);continue}i=i.concat(Yh(t,n.index,n.index+n.addedCount,n.removed,0,n.removed.length))}return i}var Ps=Object.freeze({support:Hh.optimized,normalize(t,e,i){return t===void 0?i===void 0?yi:Qh(e,i):Vs},pop(t,e,i,r){let o=t.length>0,s=i.apply(t,r);return o&&e.addSplice(new Re(t.length,[s],0)),s},push(t,e,i,r){let o=i.apply(t,r);return e.addSplice(new Re(t.length-r.length,[],r.length).adjustTo(t)),o},reverse(t,e,i,r){let o=i.apply(t,r);t.sorted++;let s=[];for(let n=t.length-1;n>=0;n--)s.push(n);return e.addSort(new uo(s)),o},shift(t,e,i,r){let o=t.length>0,s=i.apply(t,r);return o&&e.addSplice(new Re(0,[s],0)),s},sort(t,e,i,r){let o=new Map;for(let a=0,l=t.length;a<l;++a){let d=o.get(t[a])||[];o.set(t[a],[...d,a])}let s=i.apply(t,r);t.sorted++;let n=[];for(let a=0,l=t.length;a<l;++a){let d=o.get(t[a]);n.push(d[0]),o.set(t[a],d.splice(1))}return e.addSort(new uo(n)),s},splice(t,e,i,r){let o=i.apply(t,r);return e.addSplice(new Re(+r[0],o,r.length>2?r.length-2:0).adjustTo(t)),o},unshift(t,e,i,r){let o=i.apply(t,r);return e.addSplice(new Re(0,[],r.length).adjustTo(t)),o}}),Vx=Object.freeze({reset:Vs,setDefaultStrategy(t){Ps=t}});function Os(t,e,i,r=!0){Reflect.defineProperty(t,e,{value:i,enumerable:!1,writable:r})}var Ls=class extends Vt{get strategy(){return this._strategy}set strategy(e){this._strategy=e}get lengthObserver(){let e=this._lengthObserver;if(e===void 0){let i=this.subject;this._lengthObserver=e={length:i.length,handleChange(){this.length!==i.length&&(this.length=i.length,R.notify(e,"length"))}},this.subscribe(e)}return e}get sortObserver(){let e=this._sortObserver;if(e===void 0){let i=this.subject;this._sortObserver=e={sorted:i.sorted,handleChange(){this.sorted!==i.sorted&&(this.sorted=i.sorted,R.notify(e,"sorted"))}},this.subscribe(e)}return e}constructor(e){super(e),this.oldCollection=void 0,this.splices=void 0,this.sorts=void 0,this.needsQueue=!0,this._strategy=null,this._lengthObserver=void 0,this._sortObserver=void 0,this.call=this.flush,Os(e,"$fastController",this)}subscribe(e){this.flush(),super.subscribe(e)}addSplice(e){this.splices===void 0?this.splices=[e]:this.splices.push(e),this.enqueue()}addSort(e){this.sorts===void 0?this.sorts=[e]:this.sorts.push(e),this.enqueue()}reset(e){this.oldCollection=e,this.enqueue()}flush(){var e;let i=this.splices,r=this.sorts,o=this.oldCollection;i===void 0&&o===void 0&&r===void 0||(this.needsQueue=!0,this.splices=void 0,this.sorts=void 0,this.oldCollection=void 0,r!==void 0?this.notify(i===void 0&&o===void 0?r:Vs):this.notify(((e=this._strategy)!==null&&e!==void 0?e:Ps).normalize(o,this.subject,i)))}enqueue(){this.needsQueue&&(this.needsQueue=!1,K.enqueue(this))}},Za=!1,tl=Object.freeze({sorted:0,enable(){if(Za)return;Za=!0,R.setArrayObserverFactory(e=>new Ls(e));let t=Array.prototype;t.$fastPatch||(Os(t,"$fastPatch",1),Os(t,"sorted",0),[t.pop,t.push,t.reverse,t.shift,t.sort,t.splice,t.unshift].forEach(e=>{t[e.name]=function(...i){var r;let o=this.$fastController;return o===void 0?e.apply(this,i):((r=o.strategy)!==null&&r!==void 0?r:Ps)[e.name](this,o,e,i)}}))}});var Bs=xi(),Ns=Object.freeze({getForInstance:Bs.getForInstance,getByType:Bs.getByType,define(t){return Bs.register({type:t}),t}});function il(t,e){let i=[],r="";for(let o=0,s=t.length-1;o<s;++o){r+=t[o];let n=e[o];Ns.getForInstance(n)!==void 0&&(n=n.createCSS()),n instanceof _e||n instanceof CSSStyleSheet?(r.trim()!==""&&(i.push(r),r=""),i.push(n)):r+=n}return r+=t[t.length-1],r.trim()!==""&&i.push(r),i}var v=((t,...e)=>new _e(il(t,e))),ho=class{constructor(e){this.value=e.length===0?"":e.length===1?e[0]:new _e(e)}createCSS(){return this.value}};Ns.define(ho);v.partial=(t,...e)=>new ho(il(t,e));var js=`fast-${Math.random().toString(36).substring(2,8)}`,po=`${js}{`,vr=`}${js}`,Jh=vr.length,Zh=0,br=()=>`${js}-${++Zh}`,jt=Object.freeze({interpolation:t=>`${po}${t}${vr}`,attribute:t=>`${br()}="${po}${t}${vr}"`,comment:t=>`<!--${po}${t}${vr}-->`}),yr=Object.freeze({parse(t,e){let i=t.split(po);if(i.length===1)return null;let r=[];for(let o=0,s=i.length;o<s;++o){let n=i[o],a=n.indexOf(vr),l;if(a===-1)l=n;else{let d=n.substring(0,a);r.push(e[d]),l=n.substring(a+Jh)}l!==""&&r.push(l)}return r}});var Hs=xi(),de=Object.freeze({getForInstance:Hs.getForInstance,getByType:Hs.getByType,define(t,e){return e=e||{},e.type=t,Hs.register(e),t},assignAspect(t,e){if(!e){t.aspectType=W.content;return}switch(t.sourceAspect=e,e[0]){case":":t.targetAspect=e.substring(1),t.aspectType=t.targetAspect==="classList"?W.tokenList:W.property;break;case"?":t.targetAspect=e.substring(1),t.aspectType=W.booleanAttribute;break;case"@":t.targetAspect=e.substring(1),t.aspectType=W.event;break;default:t.targetAspect=e,t.aspectType=W.attribute;break}}});var xr=class{constructor(e){this.options=e}createHTML(e){return jt.attribute(e(this))}createBehavior(){return this}};we(xr);var ep=Symbol(),sl=new WeakMap;function tp(t){let e=Object.freeze(Object.assign(Object.assign({},t),{[ep]:!0}));return sl.set(e,e),e}function rl(t){return t.nodeType===Node.COMMENT_NODE}function ol(t){let e=t.getAttribute("data-fe");if(e===null)return null;let i=e.trim();if(!/^\d+$/.test(i))throw Z.error(Y.invalidHydrationAttributeMarker,{value:e});let r=parseInt(i,10);if(r<1)throw Z.error(Y.invalidHydrationAttributeMarker,{value:e});return r}var Ci=tp({attributeMarkerName:"data-fe",contentBindingStartMarker(){return"fe:b"},contentBindingEndMarker(){return"fe:/b"},repeatStartMarker(){return"fe:r"},repeatEndMarker(){return"fe:/r"},elementBoundaryStartMarker(){return"fe:e"},elementBoundaryEndMarker(){return"fe:/e"},parseAttributeBindingCount:ol,resolveAttributeBindings(t,e,i){let r=ol(t);return r!==null?{factoryIndices:Array.from({length:r},(s,n)=>e+n),nextFactoryPointer:e+r,cleanup:()=>t.removeAttribute("data-fe")}:null},resolveContentBinding(t,e,i){return t==="fe:b"?{factoryIndices:[e],nextFactoryPointer:e+1}:null},isContentBindingStartMarker(t){return t==="fe:b"},isContentBindingEndMarker(t){return t==="fe:/b"},isRepeatViewStartMarker(t){return t==="fe:r"},isRepeatViewEndMarker(t){return t==="fe:/r"},isElementBoundaryStartMarker(t){return rl(t)&&t.data==="fe:e"},isElementBoundaryEndMarker(t){return rl(t)&&t.data==="fe:/e"}}),ip=sl.get(Ci);function fo(){return ip}var wr=Symbol.for("fe-hydration");function it(t){return t[wr]===wr}var nl="unknown",al="content following `<!--fe:b-->` content binding marker",ll="matching `<!--fe:/b-->` content binding close marker",cl="matching `<!--fe:/e-->` element boundary close marker";function dl(t,e){let i=e?`: ${e}`:"";return`Hydration mismatch in <${t}>${i}. Install hydrationDebugger() from "@lushly-dev/fast-element/hydration.js" and pass it as enableHydration({ debugger: hydrationDebugger() }) for an "Expected / Received" report including the SSR HTML snippet.`}function qs(t){return`no more attribute bindings (template defines ${t})`}function ul(t){return`no more content bindings (template defines ${t})`}function hl(t,e){let i=(t??nl).toLowerCase();return dl(i,e)}var rp={formatBindingMismatch(t,e,i,r){return{message:hl(r,void 0)}},formatStructuralError(t,e,i){return{message:hl(e,i)}}},op=rp;function mo(){return op}function ri(t){var e;return t?(e=t.getRootNode().host)===null||e===void 0?void 0:e.nodeName:void 0}var Ws,Us,rw=(Ws=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(customElements),"define"))===null||Ws===void 0?void 0:Ws.value,ow=(Us=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator))===null||Us===void 0?void 0:Us.value,sp=new WeakMap;function pl(t){return sp.get(Object.getPrototypeOf(t))===!0}function go(t){return t.nodeType===8}function np(t){return t.nodeType===3}function ml(t){return go(t)||np(t)?t.data.length:t.childNodes.length}var gl=133;function Ks(t,e){let i=document.createRange();return i.setStart(t,0),i.setEnd(e,ml(e)),i}function fl(t,e,i=t){let r=Ks(t,e),o=r.startContainer===t?document.createTreeWalker(r.commonAncestorContainer,gl):null,s=e.contains(i),n=!1;o!==null&&(o.currentNode=i);function a(l){if(o===null||!n&&l&&o.currentNode.contains(e))return null;let d=o.currentNode,h=l?o.nextSibling():o.nextNode();return n||!s||e.contains(h)?(h===e&&(s=!0),h):(o.currentNode=d,null)}return[a,()=>{if(o!==null&&!n&&(r.startContainer!==t||r.endContainer!==e||r.endOffset!==ml(e)||o.currentNode!==t&&o.currentNode!==e&&!r.intersectsNode(o.currentNode))){let l=o.currentNode;o=document.createTreeWalker(o.root,o.whatToShow,{acceptNode:d=>r.comparePoint(d,0)===0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}),o.currentNode=l,n=!0}}]}function vl(t,e){let i=t.parentNode;if(i===null||i!==e.parentNode||t!==e&&!(t.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)){let[n,a]=fl(t,e);return[n,a,()=>{}]}let r=t,o=null;function s(n=!1){if(o!==null)return o[0](n);if(n&&r===e)return null;let a=r;do if(n){if(a===e)return null;a=a.nextSibling}else{let l=a;for(a=a.firstChild;a===null;){if(l===e)return null;if(a=l.nextSibling,l=l.parentNode,l===i||l===null)break}}while(a!==null&&!(gl&1<<a.nodeType-1));return a!==null&&(r=a),a}return[s,()=>o?.[1](),()=>{o??(o=fl(t,e,r))}]}var _r=class extends Error{constructor(e,i,r,o,s){super(e),this.factories=i,this.node=r,this.expected=o,this.received=s}},bl=Element.prototype.removeAttribute,yl=Element.prototype.getAttribute,ap=Element.prototype.hasAttribute;function wl(t,e,i){let r=t;for(;r!==null;){let o=Object.getOwnPropertyDescriptor(r,e);if(o!==void 0)return o.value===i;r=Object.getPrototypeOf(r)}return!1}function xl(t,e){return e?ap.call(t,"is")||!wl(t,"removeAttribute",bl):t.localName.includes("-")||t.hasAttribute("is")||"attributeChangedCallback"in t||t.removeAttribute!==bl}function zi(t,e,i){let r=mo().formatStructuralError(t,ri(t),i);throw new _r(r.message,e,t,r.expected,r.received)}function _l(t,e,i){var r;let[o,s,n]=vl(t,e),a={},l={},d=fo(),h=d===Ci;d!==Ci&&n();let p=dp(i),x=p,k=t;for(;k!==null;){switch(k.nodeType){case Node.ELEMENT_NODE:{let S=k,A=h&&S.localName.includes("-"),D=A&&pl(S);if((A?!wl(S,"getAttribute",yl):S.getAttribute!==yl)&&n(),h){let T=Ci.parseAttributeBindingCount(S);if(T!==null){T>4294967295&&Ci.resolveAttributeBindings(S,x,p);for(let I=0;I<T;I++){let M=i[x++];M||zi(k,i,qs(i.length)),kr(M,k,a)}xl(S,D)&&n(),S.removeAttribute("data-fe"),s()}break}let _=d.resolveAttributeBindings(S,x,p);if(_!==null){x=_.nextFactoryPointer;for(let T of _.factoryIndices){let I=i[T];I||zi(k,i,qs(i.length)),kr(I,k,a)}xl(S,!1)&&n(),(r=_.cleanup)===null||r===void 0||r.call(_),s()}break}case 8:{let S=k.data;if(h?S==="fe:e":d.isElementBoundaryStartMarker(k))k.data="",cp(o,i,k,d,h);else{let A;if(h){if(S!=="fe:b")break;A=x++}else{let _=d.resolveContentBinding(S,x,p);if(_===null)break;x=_.nextFactoryPointer,A=_.factoryIndices[0]}let D=i[A];D||zi(k,i,ul(i.length)),lp(k,o,D,i,a,l,d,h)}break}}k=o()}return{targets:a,boundaries:l}}function lp(t,e,i,r,o,s,n,a){let l=e(!0);t.data="",l===null&&zi(t,r,al);let d=l,h=0;for(;l!==null;){if(go(l)){if(a?l.data==="fe:b":n.isContentBindingStartMarker(l.data))h++;else if(a?l.data==="fe:/b":n.isContentBindingEndMarker(l.data)){if(h===0)break;h--}}l=e(!0)}l===null&&zi(t,r,ll),l.data="",l!==d&&l.previousSibling!==null&&(s[i.targetNodeId]={first:d,last:l.previousSibling}),kr(i,l,o)}function cp(t,e,i,r,o){let s=0,n=t(!0);for(;n!==null;){if(go(n)){if(o?n.data==="fe:e":r.isElementBoundaryStartMarker(n))n.data="",s++;else if((o?n.data==="fe:/e":r.isElementBoundaryEndMarker(n))&&(n.data="",s--===0))return}n=t(!0)}zi(i,e,cl)}function dp(t){let e=0;for(;e<t.length&&t[e].targetNodeId==="h";)e++;return e}function kr(t,e,i){let r=t.targetNodeId;if(r===void 0)throw new Error("Factory could not be target to the node");i[r]=e}function He(t,e){let i=e._scope;return i===void 0?t.create():t.create(void 0,i)}function $i(t,e,i,r){let o=r._scope;return o===void 0?t.hydrate(e,i):t.hydrate(e,i,void 0,o)}function Si(t,e){let i=t.parentNode,r=t,o;for(;r!==e;){if(o=r.nextSibling,!o)throw new Error(`Unmatched first/last child inside "${e.getRootNode().host.nodeName}".`);i.removeChild(r),r=o}i.removeChild(e)}var Cr=class{constructor(){this.index=0,this.length=0}get event(){return pt.getEvent()}get isEven(){return this.index%2===0}get isOdd(){return this.index%2!==0}get isFirst(){return this.index===0}get isInMiddle(){return!this.isFirst&&!this.isLast}get isLast(){return this.index===this.length-1}eventDetail(){return this.event.detail}eventTarget(){return this.event.target}},bt=class extends Cr{constructor(e,i,r,o){super(),this.fragment=e,this.factories=i,this.targets=r,this._scope=o,this.behaviors=null,this.unbindables=[],this.source=null,this.isBound=!1,this.sourceLifetime=Pt.unknown,this._skipAttrUpdates=!1,this.isPrerendered=Promise.resolve(!1),this.isHydrated=Promise.resolve(!1),this.context=this,this.firstChild=e.firstChild,this.lastChild=e.lastChild}appendTo(e){e.appendChild(this.fragment)}insertBefore(e){if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let i=this.lastChild;if(e.previousSibling===i)return;let r=e.parentNode,o=this.firstChild,s;for(;o!==i;)s=o.nextSibling,r.insertBefore(o,e),o=s;r.insertBefore(i,e)}}remove(){let e=this.fragment,i=this.lastChild,r=this.firstChild,o;for(;r!==i;)o=r.nextSibling,e.appendChild(r),r=o;e.appendChild(i)}dispose(){Si(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}bind(e,i=this){if(this.source===e&&this.context===i)return;let r=this.behaviors;if(r===null){this.source=e,this.context=i,this.behaviors=r=new Array(this.factories.length);let o=this.factories;for(let s=0,n=o.length;s<n;++s){let a=o[s].createBehavior();a.bind(this),r[s]=a}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=i;for(let o=0,s=r.length;o<s;++o)r[o].bind(this)}this.isBound=!0}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}evaluateUnbindables(){let e=this.unbindables;for(let i=0,r=e.length;i<r;++i)e[i].unbind(this);e.length=0}static disposeContiguousBatch(e){if(e.length!==0){Si(e[0].firstChild,e[e.length-1].lastChild);for(let i=0,r=e.length;i<r;++i)e[i].unbind()}}};we(bt);R.defineProperty(bt.prototype,"index");R.defineProperty(bt.prototype,"length");var kl,qe={unhydrated:"unhydrated",hydrating:"hydrating",hydrated:"hydrated"},Gs=class extends Error{constructor(e,i,r,o,s,n){super(e),this.factory=i,this.fragment=r,this.templateString=o,this.expected=s,this.received=n}},Ys=class extends Cr{get hydrationStage(){return this._hydrationStage}get targets(){return this._targets}get bindingViewBoundaries(){return this._bindingViewBoundaries}constructor(e,i,r,o,s){super(),this.firstChild=e,this.lastChild=i,this.sourceTemplate=r,this.hostBindingTarget=o,this._scope=s,this[kl]=wr,this.context=this,this.source=null,this.isBound=!1,this.sourceLifetime=Pt.unknown,this.unbindables=[],this.fragment=null,this.behaviors=null,this._hydrationStage=qe.unhydrated,this._bindingViewBoundaries={},this._targets={},this.factories=r.compile().factories}insertBefore(e){if(this.fragment!==null)if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let i=this.lastChild;if(e.previousSibling===i)return;let r=e.parentNode,o=this.firstChild,s;for(;o!==i;)s=o.nextSibling,r.insertBefore(o,e),o=s;r.insertBefore(i,e)}}appendTo(e){this.fragment!==null&&e.appendChild(this.fragment)}remove(){let e=this.fragment||(this.fragment=document.createDocumentFragment()),i=this.lastChild,r=this.firstChild,o;for(;r!==i;){if(o=r.nextSibling,!o)throw new Error(`Unmatched first/last child inside "${i.getRootNode().host.nodeName}".`);e.appendChild(r),r=o}e.appendChild(i)}bind(e,i=this){if(this.source===e&&this.context===i)return;this.hydrationStage!==qe.hydrated&&(this._hydrationStage=qe.hydrating);let r=this.behaviors;if(r===null){this.source=e,this.context=i;try{let{targets:s,boundaries:n}=_l(this.firstChild,this.lastChild,this.factories);this._targets=s,this._bindingViewBoundaries=n}catch(s){if(s instanceof _r){let n=this.sourceTemplate.html;typeof n!="string"&&(n=n.innerHTML),s.templateString=n}throw s}this.behaviors=r=new Array(this.factories.length);let o=this.factories;for(let s=0,n=o.length;s<n;++s){let a=o[s];if(a.targetNodeId==="h"&&this.hostBindingTarget&&kr(a,this.hostBindingTarget,this._targets),a.targetNodeId in this.targets){let l=a.createBehavior();l.bind(this),r[s]=l}else{let l=this.sourceTemplate.html;typeof l!="string"&&(l=l.innerHTML);let d=Ks(this.firstChild,this.lastChild).cloneContents(),h=mo().formatBindingMismatch(a,this.firstChild,this.lastChild,ri(this.firstChild));throw new Gs(h.message,a,d,l,h.expected,h.received)}}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=i;for(let o=0,s=r.length;o<s;++o)r[o].bind(this)}this.isBound=!0,this._hydrationStage=qe.hydrated}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}dispose(){Si(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}evaluateUnbindables(){let e=this.unbindables;for(let i=0,r=e.length;i<r;++i)e[i].unbind(this);e.length=0}};kl=wr;we(Ys);function up(t){return t.create!==void 0}function Cl(t,e){if(t.nodeType!==8){t.textContent=e;return}let i=t.$fastText;i!==void 0&&(i.textContent=e),e===""?i?.remove():(i===void 0&&(t.$fastText=i=document.createTextNode(e)),i.parentNode!==t.parentNode&&t.parentNode.insertBefore(i,t))}function hp(t,e,i,r){if(i==null&&(i=""),up(i)){Cl(t,"");let o=t.$fastView;if(o===void 0)if(it(r)&&it(i)&&r.bindingViewBoundaries[this.targetNodeId]!==void 0&&r.hydrationStage!==qe.hydrated){let s=r.bindingViewBoundaries[this.targetNodeId];o=$i(i,s.first,s.last,r)}else o=He(i,r);else t.$fastTemplate!==i&&(o.isComposed&&(o.remove(),o.unbind()),o=He(i,r));o.isComposed?o.needsBindOnly&&(o.needsBindOnly=!1,o.bind(r.source,r.context)):(o.isComposed=!0,o.bind(r.source,r.context),o.insertBefore(t),t.$fastView=o,t.$fastTemplate=i)}else{let o=t.$fastView;if(o!==void 0&&o.isComposed&&(o.isComposed=!1,o.remove(),o.needsBindOnly?o.needsBindOnly=!1:o.unbind()),o===void 0&&it(r)&&r.hydrationStage!==qe.hydrated){let s=r.bindingViewBoundaries[this.targetNodeId];s!==void 0&&(t.nodeType===8&&s.first===s.last&&s.first.nodeType===3?t.$fastText=s.first:Si(s.first,s.last),delete r.bindingViewBoundaries[this.targetNodeId])}Cl(t,i)}}function pp(t,e,i){var r;let o=`${this.id}-t`,s=(r=t[o])!==null&&r!==void 0?r:t[o]={v:0,cv:Object.create(null)},n=s.cv,a=s.v,l=t[e];if(i!=null&&i.length){let d=i.split(/\s+/);for(let h=0,p=d.length;h<p;++h){let x=d[h];x!==""&&(n[x]=a,l.add(x))}}if(s.v=a+1,a!==0){a-=1;for(let d in n)n[d]===a&&l.remove(d)}}var fp={[W.attribute]:mt.setAttribute,[W.booleanAttribute]:mt.setBooleanAttribute,[W.property]:(t,e,i)=>t[e]=i,[W.content]:hp,[W.tokenList]:pp,[W.event]:()=>{}},We=class{constructor(e){this.updateTarget=null,this.aspectType=W.content,this.dataBinding=e}createHTML(e){return jt.interpolation(e(this))}createBehavior(){var e;if(this.updateTarget===null){let i=fp[this.aspectType],r=(e=this.dataBinding.policy)!==null&&e!==void 0?e:this.policy;if(!i)throw Z.error(Y.unsupportedBindingBehavior);this.data=`${this.id}-d`,this.updateTarget=r.protect(this.targetTagName,this.aspectType,this.targetAspect,i)}return this}bind(e){var i;let r=e.targets[this.targetNodeId];switch(this.aspectType){case W.event:r[this.data]=e,r.addEventListener(this.targetAspect,this,this.dataBinding.options);break;case W.content:e.onUnbind(this);default:{let o=(i=r[this.data])!==null&&i!==void 0?i:r[this.data]=this.dataBinding.createObserver(this,this);o.target=r,o.controller=e;let s=o.bind(e);if(e._skipAttrUpdates&&(this.aspectType===W.attribute||this.aspectType===W.booleanAttribute))break;this.updateTarget(r,this.targetAspect,s,e);break}}}unbind(e){let r=e.targets[this.targetNodeId].$fastView;r!==void 0&&r.isComposed&&(r.unbind(),r.needsBindOnly=!0)}handleEvent(e){let i=e.currentTarget[this.data];if(i.isBound){pt.setEvent(e);let r=this.dataBinding.evaluate(i.source,i.context);pt.setEvent(null),r!==!0&&e.preventDefault()}}handleChange(e,i){let r=i.controller;if(!r.isBound)return;let o=i.target;this.updateTarget(o,this.targetAspect,i.bind(r),r)}};de.define(We,{aspected:!0});var Tl=(t,e)=>`${t}.${e}`,zl={},rt={index:0,node:null};function Sl(t){t.startsWith("fast-")||Z.warn(Y.hostBindingWithoutHost,{name:t})}var mp=new Proxy(document.createElement("div"),{get(t,e){Sl(e);let i=Reflect.get(t,e);return J(i)?i.bind(t):i},set(t,e,i){return Sl(e),Reflect.set(t,e,i)}}),Xs=class{constructor(e,i,r){this.fragment=e,this.directives=i,this.policy=r,this.proto=null,this.nodeIds=new Set,this.descriptors={},this.factories=[]}addFactory(e,i,r,o,s){var n,a;this.nodeIds.has(r)||(this.nodeIds.add(r),this.addTargetDescriptor(i,r,o)),e.id=(n=e.id)!==null&&n!==void 0?n:br(),e.targetNodeId=r,e.targetTagName=s,e.policy=(a=e.policy)!==null&&a!==void 0?a:this.policy,this.factories.push(e)}freeze(){return this.proto=Object.create(null,this.descriptors),this}addTargetDescriptor(e,i,r){let o=this.descriptors;if(i==="r"||i==="h"||o[i])return;if(!o[e]){let n=e.lastIndexOf("."),a=e.substring(0,n),l=parseInt(e.substring(n+1),10);this.addTargetDescriptor(a,e,l)}let s=zl[i];if(!s){let n=`_${i}`;zl[i]=s={get(){var a;return(a=this[n])!==null&&a!==void 0?a:this[n]=this[e].childNodes[r]}}}o[i]=s}createView(e,i){let r=i===void 0?this.fragment.cloneNode(!0):vp(this.fragment,i),o=Object.create(this.proto);o.r=r,o.h=e??mp;for(let s of this.nodeIds)Reflect.get(o,s);return new bt(r,this.factories,o,i)}},zr,$l=new WeakMap;function gp(t){let e=$l.get(t);return e===void 0&&(zr??(zr=document.implementation.createHTMLDocument("")),e=t.cloneNode(!0),zr.adoptNode(e),$l.set(t,e)),e}function vp(t,e){var i;let r=e,o=(i=r.customElementRegistry)!==null&&i!==void 0?i:r.registry;if(o){if(o!==globalThis.customElements&&typeof o.initialize=="function")return document.importNode(gp(t),{selfOnly:!1,customElementRegistry:o});if(typeof r.importNode=="function")return r.importNode(t,!0)}return t.cloneNode(!0)}function Il(t,e,i,r,o,s=!1){let n=i.attributes,a=t.directives;for(let l=0,d=n.length;l<d;++l){let h=n[l],p=h.value,x=yr.parse(p,a),k=null;x===null?s&&(k=new We(je(()=>p,t.policy)),de.assignAspect(k,h.name)):k=vo.aggregate(x,t.policy),k!==null&&(i.removeAttributeNode(h),l--,d--,t.addFactory(k,e,r,o,i.tagName))}}function bp(t,e,i,r,o){let s=yr.parse(e.textContent,t.directives);if(s===null)return rt.node=e.nextSibling,rt.index=o+1,rt;let n,a=n=e;for(let l=0,d=s.length;l<d;++l){let h=s[l];if(l!==0&&(o++,r=Tl(i,o),n=a.parentNode.insertBefore(document.createTextNode(""),a.nextSibling)),ce(h))n.textContent=h;else{if(de.assignAspect(h),h instanceof We){let p=document.createComment("");n.parentNode.replaceChild(p,n),n=p}else n.textContent=" ";t.addFactory(h,i,r,o,null)}a=n}return rt.index=o+1,rt.node=a.nextSibling,rt}function Al(t,e,i){let r=0,o=e.firstChild;for(;o;){let s=yp(t,i,o,r);o=s.node,r=s.index}}function yp(t,e,i,r){let o=Tl(e,r);switch(i.nodeType){case 1:Il(t,e,i,o,r),Al(t,i,o);break;case 3:return bp(t,i,e,o,r);case 8:{let s=yr.parse(i.data,t.directives);s!==null&&t.addFactory(vo.aggregate(s),e,o,r,null);break}}return rt.index=r+1,rt.node=i.nextSibling,rt}function xp(t,e){if(!t||t.nodeType!==8&&t.nodeType!==3)return!1;let i=yr.parse(t.data,e);return i!==null&&(t.nodeType===8||!ce(i[0]))}var El="TEMPLATE",vo={compile(t,e,i=mt.policy){let r;if(ce(t)){r=document.createElement(El),r.innerHTML=i.createHTML(t);let n=r.content.firstElementChild;n!==null&&n.tagName===El&&(r=n)}else r=t;!r.content.firstChild&&!r.content.lastChild&&r.content.appendChild(document.createComment(""));let o=document.adoptNode(r.content),s=new Xs(o,e,i);return Il(s,"",r,"h",0,!0),(xp(o.firstChild,e)||o.childNodes.length===1&&Object.keys(e).length>0)&&o.insertBefore(document.createComment(""),o.firstChild),Al(s,o,"r"),rt.node=null,s.freeze()},setDefaultStrategy(t){this.compile=t},aggregate(t,e=mt.policy){if(t.length===1)return t[0];let i,r=!1,o,s=t.length,n=t.map(d=>ce(d)?()=>d:(i=d.sourceAspect||i,r=r||d.dataBinding.isVolatile,o=o||d.dataBinding.policy,d.dataBinding.evaluate)),a=(d,h)=>{let p="";for(let x=0;x<s;++x)p+=n[x](d,h);return p},l=new We(Bt(a,o??e,r));return de.assignAspect(l,i),l}};var Sr=class extends xr{bind(e){e.source[this.options]=e.targets[this.targetNodeId]}};de.define(Sr);var bo=t=>new Sr(t);var wp=/([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/,_p=Object.create(null),Ht=class{constructor(e,i=_p){this.html=e,this.factories=i}createHTML(e){let i=this.factories;for(let r in i)e(i[r]);return this.html}};Ht.empty=new Ht("");de.define(Ht);function kp(t,e,i,r=de.getForInstance(t)){if(r.aspected){let o=wp.exec(e);o!==null&&de.assignAspect(t,o[2])}return t.createHTML(i)}var oi=class t{constructor(e,i={},r){this.policy=r,this.result=null,this.html=e,this.factories=i}compile(){return this.result===null&&(this.result=vo.compile(this.html,this.factories,this.policy)),this.result}inline(){return new Ht(ce(this.html)?this.html:this.html.innerHTML,this.factories)}withPolicy(e){if(this.result)throw Z.error(Y.cannotSetTemplatePolicyAfterCompilation);if(this.policy)throw Z.error(Y.onlySetTemplatePolicyOnce);return this.policy=e,this}render(e,i,r,o){let s=this.create(r,o);return s.bind(e),s.appendTo(i),s}create(e,i){return this.compile().createView(e,i)}static create(e,i,r){let o="",s=Object.create(null),n=a=>{var l;let d=(l=a.id)!==null&&l!==void 0?l:a.id=br();return s[d]=a,d};for(let a=0,l=e.length-1;a<l;++a){let d=e[a],h=i[a],p;if(o+=d,J(h))h=new We(Bt(h));else if(h instanceof Me)h=new We(h);else if(!(p=de.getForInstance(h))){let x=h;h=new We(je(()=>x))}o+=kp(h,d,n,p)}return new t(o+e[e.length-1],s,r)}};we(oi);var u=((t,...e)=>{if(Array.isArray(t)&&Array.isArray(t.raw))return oi.create(t,e);throw Z.error(Y.directCallToHTMLTagNotAllowed)});u.partial=t=>new Ht(t);var xo=class{constructor(e){this.directive=e,this.location=null,this.controller=null,this.view=null,this.data=null,this.dataBindingObserver=e.dataBinding.createObserver(this,e),this.templateBindingObserver=e.templateBinding.createObserver(this,e)}bind(e){if(this.location=e.targets[this.directive.targetNodeId],this.controller=e,this.data=this.dataBindingObserver.bind(e),this.template=this.templateBindingObserver.bind(e),e.onUnbind(this),it(this.template)&&it(e)&&e.hydrationStage!==qe.hydrated&&!this.view){let i=e.bindingViewBoundaries[this.directive.targetNodeId];if(i){this.view=$i(this.template,i.first,i.last,e),this.bindView(this.view);return}}this.refreshView()}unbind(e){let i=this.view;i!==null&&i.isComposed&&(i.unbind(),i.needsBindOnly=!0)}handleChange(e,i){this.controller.isBound&&(i===this.dataBindingObserver&&(this.data=this.dataBindingObserver.bind(this.controller)),(this.directive.templateBindingDependsOnData||i===this.templateBindingObserver)&&(this.template=this.templateBindingObserver.bind(this.controller)),this.refreshView())}bindView(e){e.isComposed?e.needsBindOnly&&(e.needsBindOnly=!1,e.bind(this.data)):(e.isComposed=!0,e.bind(this.data),e.insertBefore(this.location),e.$fastTemplate=this.template)}refreshView(){let e=this.view,i=this.template;e===null?(this.view=e=He(i,this.controller),this.view.context.parent=this.controller.source,this.view.context.parentContext=this.controller.context):e.$fastTemplate!==i&&(e.isComposed&&(e.remove(),e.unbind()),this.view=e=He(i,this.controller),this.view.context.parent=this.controller.source,this.view.context.parentContext=this.controller.context),this.bindView(e)}},Er=class{constructor(e,i,r){this.dataBinding=e,this.templateBinding=i,this.templateBindingDependsOnData=r}createHTML(e){return jt.comment(e(this))}createBehavior(){return new xo(this)}};de.define(Er);function Cp(t){return!!t.element||!!t.tagName}var Qs=new Map,zp={":model":t=>t},Rl=Symbol("RenderInstruction"),Fl="default-view",Sp=u`
    &nbsp;
`;function yo(t){return t===void 0?Sp:t.template}function $p(t,e,i,r){var o;return ce(t)?yo($r(e.evaluate(i,r),t)):t instanceof Node?(o=t.$fastTemplate)!==null&&o!==void 0?o:new Ei(t):t}function Ep(t,e){let i=t.evaluate,r=Object.create(Object.getPrototypeOf(t));for(let o of Object.getOwnPropertyNames(t))o!=="evaluate"&&Object.defineProperty(r,o,Object.getOwnPropertyDescriptor(t,o));return Object.defineProperty(r,"evaluate",{configurable:!0,enumerable:!0,value:(o,s)=>$p(i(o,s),e,o,s),writable:!0}),r}function Dl(t,e){let i=[],r=[],{attributes:o,directives:s,content:n,policy:a}=e??{};if(i.push(`<${t}`),o){let l=Object.getOwnPropertyNames(o);for(let d=0,h=l.length;d<h;++d){let p=l[d];d===0?i[0]=`${i[0]} ${p}="`:i.push(`" ${p}="`),r.push(o[p])}i.push('"')}if(s){i[i.length-1]+=" ";for(let l=0,d=s.length;l<d;++l){let h=s[l];i.push(l>0?"":" "),r.push(h)}}if(i[i.length-1]+=">",n&&J(n.create))r.push(n),i.push(`</${t}>`);else{let l=i.length-1;i[l]=`${i[l]}${n??""}</${t}>`}return oi.create(i,r,a)}function Ml(t){var e;let i=(e=t.name)!==null&&e!==void 0?e:Fl,r;if(Cp(t)){let o=t.tagName;if(!o){let s=ve.getByType(t.element);if(s)o=s.name;else throw new Error("Invalid element for model rendering.")}t.attributes||(t.attributes=zp),r=Dl(o,t)}else r=t.template;return{brand:Rl,type:t.type,name:i,template:r}}function Ol(t){return t&&t.brand===Rl}function Tp(t){let e=Qs.get(t.type);e===void 0&&Qs.set(t.type,e=Object.create(null));let i=Ol(t)?t:Ml(t);if(e[i.name]!==void 0){let r=i.type.name||"(anonymous)";Z.warn(Y.duplicateRenderInstruction,{type:r,name:i.name})}return e[i.name]=i}function Ll(t,e){let i=Qs.get(t);if(i!==void 0)return i[e??Fl]}function $r(t,e){if(t)return Ll(t.constructor,e)}var m0=Object.freeze({instanceOf:Ol,create:Ml,createElementTemplate:Dl,register:Tp,getByType:Ll,getForInstance:$r});var Ei=class{constructor(e){this.node=e,e.$fastTemplate=this}get context(){return this}bind(e){}unbind(){}insertBefore(e){e.parentNode.insertBefore(this.node,e)}remove(){this.node.parentNode.removeChild(this.node)}create(){return this}hydrate(e,i){return this}};function si(t,e){let i;t===void 0?i=je(s=>s):i=gr(t);let r,o=!1;return e===void 0?(o=!0,r=je((s,n)=>{var a;let l=i.evaluate(s,n);return l instanceof Node?(a=l.$fastTemplate)!==null&&a!==void 0?a:new Ei(l):yo($r(l))})):J(e)?r=Bt((s,n)=>{var a;let l=e(s,n);return ce(l)?l=yo($r(i.evaluate(s,n),l)):l instanceof Node&&(l=(a=l.$fastTemplate)!==null&&a!==void 0?a:new Ei(l)),l},void 0,!0):ce(e)?(o=!0,r=je((s,n)=>{var a;let l=i.evaluate(s,n);return l instanceof Node?(a=l.$fastTemplate)!==null&&a!==void 0?a:new Ei(l):yo($r(l,e))})):e instanceof Me?r=Ep(e,i):r=je((s,n)=>e),new Er(i,r,o)}function Ip(t){return t.nodeType===Node.COMMENT_NODE}function Vl(t,e,i){let r=[],o=[],s=t;for(;s!==null&&s!==e;){if(Ip(s)){let n=s.data;if(i.isRepeatViewStartMarker(n))o.push(s);else if(i.isRepeatViewEndMarker(n)){let a=o.pop();if(a===void 0){let l=s.previousSibling===null?"end should never be null.":"repeat start marker not found.";throw new Error(`Error when hydrating inside "${ri(e)}": ${l}`)}if(o.length===0){let l=a.nextSibling,d=s.previousSibling;r.push({start:l,end:d===a?l:d,startMarker:a,endMarker:s})}}}s=s.nextSibling}if(o.length!==0)throw new Error(`Error when hydrating inside "${ri(e)}": repeat end marker not found.`);return r}var Pl=Object.freeze({positioning:!1,recycle:!0});function Ap(t,e,i,r){t.context.parent=r.source,t.context.parentContext=r.context,t.bind(e[i])}function Rp(t,e,i,r){t.context.parent=r.source,t.context.parentContext=r.context,t.context.length=e.length,t.context.index=i,t.bind(e[i])}function Fp(t,e){let i=t.parentNode;if(i===null)return;let r=t;for(;r!==null;){let o=r.nextSibling;if(i.removeChild(r),r===e)break;r=o}}var wo=class extends Error{constructor(e,i){super(e),this.propertyBag=i}},_o=class{constructor(e){this.directive=e,this.isBound=!1,this.items=null,this.itemsObserver=null,this.bindView=Ap,this.views=[],this.itemsBindingObserver=e.dataBinding.createObserver(this,e),this.templateBindingObserver=e.templateBinding.createObserver(this,e),e.options.positioning&&(this.bindView=Rp)}bind(e){this.location=e.targets[this.directive.targetNodeId],this.controller=e,this.isBound=!0,this.items=this.itemsBindingObserver.bind(e),this.template=this.templateBindingObserver.bind(e),this.observeItems(!0),it(this.template)&&it(e)&&e.hydrationStage!==qe.hydrated?this.hydrateViews(this.template):this.refreshAllViews(),e.onUnbind(this)}unbind(){this.isBound=!1,this.itemsObserver!==null&&this.itemsObserver.unsubscribe(this),this.unbindAllViews()}handleChange(e,i){if(this.isBound)if(i===this.itemsBindingObserver)this.items=this.itemsBindingObserver.bind(this.controller),this.observeItems(),this.refreshAllViews();else if(i===this.templateBindingObserver)this.template=this.templateBindingObserver.bind(this.controller),this.refreshAllViews(!0);else if(i[0])i[0].reset?this.refreshAllViews():i[0].sorted?this.updateSortedViews(i):this.updateSplicedViews(i);else return}observeItems(e=!1){if(!this.items){this.items=yi;return}let i=this.itemsObserver,r=this.itemsObserver=R.getNotifier(this.items),o=i!==r;o&&i!==null&&i.unsubscribe(this),(o||e)&&r.subscribe(this)}updateSortedViews(e){let i=this.views;for(let r=0,o=e.length;r<o;++r){let s=e[r].sorted.slice(),n=s.slice().sort((a,l)=>a-l);for(let a=0,l=s.length;a<l;++a){let d=s.find(h=>s[a]===n[h]);if(d!==a){let h=n.splice(d,1);n.splice(a,0,...h);let p=i[a],x=p?p.firstChild:this.location;i[d].remove(),i[d].insertBefore(x);let k=i.splice(d,1);i.splice(a,0,...k)}}}}updateSplicedViews(e){let i=this.views,r=this.bindView,o=this.items,s=this.template,n=this.controller,a=this.directive.options.recycle,l=[],d=0,h=0;for(let p=0,x=e.length;p<x;++p){let k=e[p],S=k.removed,A=0,D=k.index,_=D+k.addedCount,T=i.splice(k.index,S.length),I=h=l.length+T.length;for(;D<_;++D){let M=i[D],V=M?M.firstChild:this.location,O;a&&h>0?(A<=I&&T.length>0?(O=T[A],A++):(O=l[d],d++),h--):O=He(s,n),i.splice(D,0,O),r(O,o,D,n),O.insertBefore(V)}T[A]&&l.push(...T.slice(A))}for(let p=d,x=l.length;p<x;++p)l[p].dispose();if(this.directive.options.positioning)for(let p=0,x=i.length;p<x;++p){let k=i[p].context;k.length=x,k.index=p}}refreshAllViews(e=!1){let i=this.items,r=this.template,o=this.location,s=this.bindView,n=this.controller,a=i.length,l=this.views,d=l.length;if((a===0||e||!this.directive.options.recycle)&&(bt.disposeContiguousBatch(l),d=0),d===0){this.views=l=new Array(a);for(let h=0;h<a;++h){let p=He(r,n);s(p,i,h,n),l[h]=p,p.insertBefore(o)}}else{let h=0;for(;h<a;++h)if(h<d){let x=l[h];if(!x){let k=new XMLSerializer;throw new wo(`View is null or undefined inside "${this.location.getRootNode().host.nodeName}".`,{index:h,hydrationStage:this.controller.hydrationStage,itemsLength:a,viewsState:l.map(S=>S?"hydrated":"empty"),viewTemplateString:k.serializeToString(r.create().fragment),rootNodeContent:k.serializeToString(this.location.getRootNode())})}s(x,i,h,n)}else{let x=He(r,n);s(x,i,h,n),l.push(x),x.insertBefore(o)}let p=l.splice(h,d-h);for(h=0,a=p.length;h<a;++h)p[h].dispose()}}unbindAllViews(){let e=this.views;for(let i=0,r=e.length;i<r;++i){let o=e[i];if(!o){let s=new XMLSerializer;throw new wo(`View is null or undefined inside "${this.location.getRootNode().host.nodeName}".`,{index:i,hydrationStage:this.controller.hydrationStage,viewsState:e.map(n=>n?"hydrated":"empty"),rootNodeContent:s.serializeToString(this.location.getRootNode())})}o.unbind()}}hydrateViews(e){var i;if(!this.items)return;let r=this.items,o=r.length,s=this.views=new Array(o),n=fo(),a=this.controller.bindingViewBoundaries[this.directive.targetNodeId],l=Vl((i=a?.first)!==null&&i!==void 0?i:this.location,this.location,n);for(let{startMarker:h,endMarker:p}of l)h.data="",p.data="";let d=Math.min(l.length,o);for(let h=0;h<d;h++){let{start:p,end:x}=l[h],k=$i(e,p,x,this.controller);s[h]=k,this.bindView(k,r,h,this.controller)}for(let h=d;h<o;h++){let p=He(e,this.controller);s[h]=p,this.bindView(p,r,h,this.controller),p.insertBefore(this.location)}for(let h=o,p=l.length;h<p;h++){let{startMarker:x,endMarker:k}=l[h];Fp(x,k)}}},Tr=class{createHTML(e){return jt.comment(e(this))}constructor(e,i,r){this.dataBinding=e,this.templateBinding=i,this.options=r,tl.enable()}createBehavior(){return new _o(this)}};de.define(Tr);function L(t,e,i=Pl){let r=gr(t),o=gr(e);return new Tr(r,o,Object.assign(Object.assign({},Pl),i))}var Dp=()=>null;function Bl(t){return t===void 0?Dp:J(t)?t:()=>t}function b(t,e,i){if(!J(e)&&!J(i)){let n=e??null,a=i??null;if(!J(t)){let l=t?n:a;return()=>l}return(l,d)=>t(l,d)?n:a}let r=J(t)?t:()=>t,o=Bl(e),s=Bl(i);return(n,a)=>r(n,a)?o(n,a):s(n,a)}var Ce=v`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body, "Montserrat", "Segoe UI", sans-serif);

        --_action-primary-background: var(--color-action-primary-background, #c84f3b);
        --_action-primary-text: var(--color-action-primary-text, #ffffff);
        --_action-primary-hover: var(--color-action-primary-hover, #bd4a37);
        --_action-primary-pressed: var(--color-action-primary-pressed, #b54633);
        --_action-secondary-background: var(--color-action-secondary-background, #f0efe6);
        --_action-secondary-text: var(--color-action-secondary-text, #18181b);
        --_action-secondary-border: var(--color-action-secondary-border, rgba(28, 26, 13, 0.18));
        --_action-secondary-hover: var(--color-action-secondary-hover, #e7e4d8);
        --_action-secondary-pressed: var(--color-action-secondary-pressed, #ddd9cb);
        --_action-danger-background: var(--color-action-danger-background, #b42318);
        --_action-danger-text: var(--color-action-danger-text, #ffffff);
        --_action-danger-hover: var(--color-action-danger-hover, #a32015);
        --_action-danger-pressed: var(--color-action-danger-pressed, #911d12);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_text-secondary: var(--color-text-secondary, #414651);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-control: var(--shadow-control, 0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-size-compact: calc(var(--_type-body-size) - 1px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_auto-control-type-size: var(--_type-body-size);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-type-size: var(--violet-control-type-size, var(--_auto-control-type-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (pointer: fine) {
        :host {
            --_auto-target-size: var(--_target-size-compact);
            --_auto-control-type-size: var(--_type-body-size-compact);
        }
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
            --_auto-control-type-size: var(--_type-body-size);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`,F=v`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body, "Montserrat", "Segoe UI", sans-serif);

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_field-border: var(--color-field-border, rgba(28, 26, 13, 0.48));
        --_field-border-hover: var(--color-field-border-hover, rgba(28, 26, 13, 0.64));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_danger-border: var(--color-field-border-invalid, #b42318);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-control: var(--shadow-control, 0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_space-stack-2xs: calc(var(--_space-stack-xs) / 2);
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_type-label-size: var(--type-label-sm-size, 12px);
        --_type-label-line: var(--type-label-sm-line, 16px);
        --_type-label-weight: var(--type-label-sm-weight, 500);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-size: var(--type-caption-xs-size, 11px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
        --_type-label-size-compact: calc(var(--_type-label-size) - 1px);
        --_type-body-size-compact: calc(var(--_type-body-size) - 1px);
        --_type-caption-size-compact: calc(var(--_type-caption-size) - 1px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_auto-control-label-size: var(--_type-label-size);
        --_auto-control-body-size: var(--_type-body-size);
        --_auto-control-caption-size: var(--_type-caption-size);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-label-size: var(--violet-control-label-size, var(--_auto-control-label-size));
        --_control-body-size: var(--violet-control-body-size, var(--_auto-control-body-size));
        --_control-caption-size: var(--violet-control-caption-size, var(--_auto-control-caption-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (pointer: fine) {
        :host {
            --_auto-target-size: var(--_target-size-compact);
            --_auto-control-label-size: var(--_type-label-size-compact);
            --_auto-control-body-size: var(--_type-body-size-compact);
            --_auto-control-caption-size: var(--_type-caption-size-compact);
        }
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
            --_auto-control-label-size: var(--_type-label-size);
            --_auto-control-body-size: var(--_type-body-size);
            --_auto-control-caption-size: var(--_type-caption-size);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`,E=v`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body, "Montserrat", "Segoe UI", sans-serif);

        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_surface-hover: var(--color-action-secondary-hover, #e7e4d8);
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_success-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_shadow-card: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_radius-lg: var(--radius-lg, 6px);
        --_radius-round: var(--radius-round, 9999px);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_space-stack-2xs: calc(var(--_space-stack-xs) / 2);
        --_space-sm: var(--space-inline-md, 8px);
        --_space-md: var(--space-layout-sm, 12px);
        --_space-lg: var(--space-layout-md, 24px);
        --_body-size: var(--type-body-md-size, 14px);
        --_body-line: var(--type-body-md-line, 20px);
        --_caption-size: var(--type-caption-xs-size, 11px);
        --_caption-line: var(--type-caption-xs-line, 14px);
        --_meta-size: var(--type-caption-xs-size, 11px);
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`;var Mp=v`
    ${Ce}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_type-body-line: var(--type-body-md-line, 20px);
    }

    .control {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* The target size is a floor: wrapped or text-zoomed labels grow the control. */
        align-self: flex-start;
        min-block-size: var(--_target-size);
        min-inline-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        /* A one-line label fills the target exactly; extra lines keep this inset. */
        padding-block: max(0px, calc((var(--_target-size) - var(--_type-body-line)) / 2 - 1px));
        border: thin solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        box-shadow: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line);
        font-weight: 500;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control:hover {
        transform: translateY(-1px);
        box-shadow: var(--_shadow-control);
    }

    .control:active {
        transform: translateY(0);
    }

    .control:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: calc(var(--_space-inline-sm) / 2);
    }

    .control[data-appearance="primary"] {
        background: var(--_action-primary-background);
        color: var(--_action-primary-text);
    }

    .control[data-appearance="primary"]:hover {
        background: var(--_action-primary-hover);
    }

    .control[data-appearance="primary"]:active {
        background: var(--_action-primary-pressed);
    }

    .control[data-appearance="secondary"] {
        background: var(--_action-secondary-background);
        color: var(--_action-secondary-text);
        border-color: var(--_action-secondary-border);
    }

    .control[data-appearance="secondary"]:hover {
        background: var(--_action-secondary-hover);
    }

    .control[data-appearance="secondary"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="quiet"] {
        color: var(--_text-secondary);
        border-color: var(--_border-subtle);
        background: transparent;
    }

    .control[data-appearance="quiet"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="quiet"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="danger"] {
        background: var(--_action-danger-background);
        color: var(--_action-danger-text);
    }

    .control[data-appearance="danger"]:hover {
        background: var(--_action-danger-hover);
    }

    .control[data-appearance="danger"]:active {
        background: var(--_action-danger-pressed);
    }

    .control[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    .label {
        display: inline-flex;
        align-items: center;
        text-align: center;
    }

    slot[name="before"],
    slot[name="after"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    ::slotted([slot="after"]) {
        margin-inline-start: var(--_space-inline-sm);
    }

    .control[data-appearance="transparent"] {
        color: var(--_text-secondary);
        border-color: transparent;
        background: transparent;
        box-shadow: none;
    }

    .control[data-appearance="transparent"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="transparent"]:active {
        background: var(--_action-secondary-pressed);
    }
`,Op=u`
    <button
        class="control"
        part="control"
        type="${t=>t.type}"
        data-appearance="${t=>t.appearance}"
        ?disabled="${t=>t.disabled}"
        aria-label="${t=>t.ariaLabel||null}"
        aria-description="${t=>t.ariaDescription||null}"
        aria-expanded="${t=>t.ariaExpanded}"
        aria-haspopup="${t=>t.ariaHasPopup}"
        aria-pressed="${t=>t.ariaPressed}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </button>
`,Lp={"aria-labelledby":"ariaLabelledByElements","aria-describedby":"ariaDescribedByElements","aria-errormessage":"ariaErrorMessageElements","aria-controls":"ariaControlsElements"},be=class extends f{constructor(){super(),this.appearance="primary",this.type="button",this.disabled=!1,this.ariaLabel=""}connectedCallback(){super.connectedCallback(),this.#e("aria-labelledby",this.ariaLabelledby),this.#e("aria-describedby",this.ariaDescribedby),this.#e("aria-errormessage",this.ariaErrormessage),this.#e("aria-controls",this.ariaControls)}ariaLabelledbyChanged(e,i){this.#e("aria-labelledby",i)}ariaDescribedbyChanged(e,i){this.#e("aria-describedby",i)}ariaErrormessageChanged(e,i){this.#e("aria-errormessage",i)}ariaControlsChanged(e,i){this.#e("aria-controls",i)}ariaExpandedChanged(e,i){this.#t("aria-expanded",i)}ariaHasPopupChanged(e,i){this.#t("aria-haspopup",i)}ariaPressedChanged(e,i){this.#t("aria-pressed",i)}#e(e,i){let r=this.shadowRoot?.querySelector("button");if(!r)return;let o=this.getRootNode(),s=(i??"").split(/\s+/).filter(Boolean),n=o instanceof Document||o instanceof ShadowRoot?s.map(a=>o.getElementById(a)).filter(a=>a!==null):[];r[Lp[e]]=n.length>0?n:null}#t(e,i){let r=this.shadowRoot?.querySelector("button");r&&(i===null?r.removeAttribute(e):r.setAttribute(e,i))}};c(be.prototype,"appearance");c(be.prototype,"type");c({mode:"boolean"})(be.prototype,"disabled");m(be.prototype,"ariaLabel");c({attribute:"aria-labelledby"})(be.prototype,"ariaLabelledby");c({attribute:"aria-describedby"})(be.prototype,"ariaDescribedby");c({attribute:"aria-errormessage"})(be.prototype,"ariaErrormessage");c({attribute:"aria-controls"})(be.prototype,"ariaControls");c({attribute:"aria-description"})(be.prototype,"ariaDescription");c({attribute:"aria-expanded"})(be.prototype,"ariaExpanded");c({attribute:"aria-haspopup"})(be.prototype,"ariaHasPopup");c({attribute:"aria-pressed"})(be.prototype,"ariaPressed");customElements.get("violet-button")||await f.define(be,{name:"violet-button",template:Op,styles:Mp,shadowOptions:{delegatesFocus:!0}});var Nl=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Vp=v`
    ${E}

    :host {
        display: block;

        --_card-border-width: 1px;
        --_card-padding: var(--violet-card-padding, 0);
        --_card-radius: var(--violet-card-radius, var(--_radius-md));
        --_card-background: var(--violet-card-background, var(--_surface-card));
        --_card-border-color: var(--violet-card-border-color, transparent);
        --_card-shadow: var(--violet-card-shadow, var(--_shadow-card));
    }

    :host([padding="small"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-sm));
    }

    :host([padding="medium"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-md));
    }

    :host([padding="large"]) {
        --_card-padding: var(--violet-card-padding, var(--_space-lg));
    }

    :host([appearance="outline"]) {
        --_card-background: var(--violet-card-background, transparent);
        --_card-border-color: var(--violet-card-border-color, var(--_border-subtle));
        --_card-shadow: var(--violet-card-shadow, none);
    }

    :host([appearance="subtle"]) {
        --_card-background: var(--violet-card-background, var(--_surface-subtle));
        --_card-border-color: var(--violet-card-border-color, transparent);
        --_card-shadow: var(--violet-card-shadow, none);
    }

    .root {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        border: var(--_card-border-width) solid var(--_card-border-color);
        border-radius: var(--_card-radius);
        background: var(--_card-background);
        box-shadow: var(--_card-shadow);
        overflow: hidden;
        transition:
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([orientation="horizontal"]) .root {
        flex-direction: row;
    }

    :host([interactive]) .root {
        cursor: pointer;
    }

    :host([interactive]) .root:hover {
        box-shadow:
            var(--_card-shadow),
            0 0 0 1px var(--_border-subtle);
        transform: translateY(-1px);
    }

    :host([interactive]) .root:active {
        transform: translateY(0);
    }

    :host([interactive]:focus-visible) .root {
        box-shadow:
            var(--_card-shadow),
            0 0 0 2px var(--_focus-ring);
    }

    .header {
        padding: var(--_card-padding);
    }

    .header[hidden] {
        display: none;
    }

    .header:not([hidden]) + .body {
        border-block-start: var(--_card-border-width) solid var(--_border-subtle);
    }

    .body {
        display: flex;
        flex-direction: column;
        padding: var(--_card-padding);
        flex: 1;
    }

    :host([orientation="horizontal"]) .body {
        flex-direction: row;
    }

    .footer {
        padding: var(--_card-padding);
    }

    .footer[hidden] {
        display: none;
    }

    .footer:not([hidden]) {
        border-block-start: var(--_card-border-width) solid var(--_border-subtle);
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border: var(--_card-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .header:not([hidden]) + .body {
            border-block-start-color: ButtonText;
        }

        .footer:not([hidden]) {
            border-block-start-color: ButtonText;
        }
    }
`,Pp=u`
    <div class="root" part="root">
        <div class="header" part="header" ?hidden="${t=>!t.hasHeader}">
            <slot name="header" @slotchange="${t=>t.handleHeaderSlotChange()}"></slot>
        </div>
        <div class="body" part="body">
            <slot></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter}">
            <slot name="footer" @slotchange="${t=>t.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`,yt=class extends f{constructor(){super(),this.hasHeader=!1,this.hasFooter=!1,this.padding="none",this.appearance="filled",this.interactive=!1,this.orientation="vertical"}connectedCallback(){super.connectedCallback(),this.handleHeaderSlotChange(),this.handleFooterSlotChange(),this.#e()}interactiveChanged(){this.$fastController.isConnected&&this.#e()}handleHeaderSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="header"]');this.hasHeader=!!this.querySelector('[slot="header"]')||(e?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0);let i=this.shadowRoot?.querySelector(".header");i&&(i.hidden=!this.hasHeader)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=!!this.querySelector('[slot="footer"]')||(e?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0);let i=this.shadowRoot?.querySelector(".footer");i&&(i.hidden=!this.hasFooter)}#e(){this.interactive?(this.hasAttribute("tabindex")||this.setAttribute("tabindex","0"),this.hasAttribute("role")||this.setAttribute("role","group")):(this.getAttribute("tabindex")==="0"&&this.removeAttribute("tabindex"),this.getAttribute("role")==="group"&&this.removeAttribute("role"))}};Nl([m],yt.prototype,"hasHeader",void 0);Nl([m],yt.prototype,"hasFooter",void 0);c(yt.prototype,"padding");c(yt.prototype,"appearance");c({mode:"boolean"})(yt.prototype,"interactive");c(yt.prototype,"orientation");customElements.get("violet-card")||await f.define(yt,{name:"violet-card",template:Pp,styles:Vp,shadowOptions:{delegatesFocus:!0}});var Bp='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M5 5L19 19"/><path d="M19 5L5 19"/></svg>',jl=new Map;function Np(t){let e=jl.get(t);return e||(e=u`${u.partial(t)}`,jl.set(t,e)),e}var jp=v`
    :host {
        display: inline-flex;
        inline-size: var(--violet-icon-size, 1em);
        block-size: var(--violet-icon-size, 1em);
        align-items: center;
        justify-content: center;
        aspect-ratio: 1 / 1;
        color: inherit;
        flex: 0 0 auto;
    }

    .glyph {
        display: inline-flex;
        inline-size: 100%;
        block-size: 100%;
        align-items: center;
        justify-content: center;
        color: inherit;
    }

    .glyph svg {
        display: block;
        inline-size: 100%;
        block-size: 100%;
    }
`,Hp=u`
    <span
        class="glyph"
        part="glyph"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-label="${t=>t.decorative?null:t.label||t.icon}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
    >
        ${t=>Np(Ia(t.icon)?.svg??Bp)}
    </span>
`,Ti=class extends f{constructor(){super(),this.icon="system/search",this.label="",this.decorative=!1}};c(Ti.prototype,"icon");c(Ti.prototype,"label");c({mode:"boolean"})(Ti.prototype,"decorative");customElements.get("violet-icon")||await f.define(Ti,{name:"violet-icon",template:Hp,styles:jp});var qp=v`
    ${Ce}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_icon-size: clamp(16px, calc(var(--_target-size) * 0.6667), 20px);
    }

    .control {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_target-size);
        block-size: var(--_target-size);
        padding: 0;
        border: thin solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        box-shadow: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: 1;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control:hover {
        transform: translateY(-1px);
        box-shadow: var(--_shadow-control);
    }

    .control:active {
        transform: translateY(0);
    }

    .control:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: calc(var(--_space-inline-sm) / 2);
    }

    .control[data-appearance="primary"] {
        background: var(--_action-primary-background);
        color: var(--_action-primary-text);
    }

    .control[data-appearance="primary"]:hover {
        background: var(--_action-primary-hover);
    }

    .control[data-appearance="primary"]:active {
        background: var(--_action-primary-pressed);
    }

    .control[data-appearance="secondary"] {
        background: var(--_action-secondary-background);
        color: var(--_action-secondary-text);
        border-color: var(--_action-secondary-border);
    }

    .control[data-appearance="secondary"]:hover {
        background: var(--_action-secondary-hover);
    }

    .control[data-appearance="secondary"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="quiet"] {
        color: var(--_text-secondary);
        border-color: var(--_border-subtle);
        background: transparent;
    }

    .control[data-appearance="quiet"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="quiet"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[data-appearance="transparent"] {
        color: var(--_text-secondary);
        border-color: transparent;
        background: transparent;
        box-shadow: none;
    }

    .control[data-appearance="transparent"]:hover {
        background: var(--_action-secondary-background);
    }

    .control[data-appearance="transparent"]:active {
        background: var(--_action-secondary-pressed);
    }

    .control[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_icon-size);
        block-size: var(--_icon-size);
        min-inline-size: var(--_icon-size);
        min-block-size: var(--_icon-size);
        flex: 0 0 auto;
        line-height: 0;
    }

    ::slotted(*) {
        max-inline-size: 100%;
        max-block-size: 100%;
    }

    ::slotted(img),
    ::slotted(svg),
    ::slotted(violet-icon) {
        display: block;
        inline-size: 100%;
        block-size: 100%;
    }

    ::slotted(violet-icon) {
        --violet-icon-size: var(--_icon-size);
        color: inherit;
    }

    ::slotted(img) {
        object-fit: cover;
    }
`,Wp=u`
    <button
        class="control"
        part="control"
        type="${t=>t.type}"
        data-appearance="${t=>t.appearance}"
        aria-label="${t=>t.label}"
        title="${t=>t.label}"
        ?disabled="${t=>t.disabled}"
    >
        <span class="icon" part="icon"><slot></slot></span>
    </button>
`,ni=class extends f{constructor(){super(),this.appearance="secondary",this.label="",this.type="button",this.disabled=!1}};c(ni.prototype,"appearance");c(ni.prototype,"label");c(ni.prototype,"type");c({mode:"boolean"})(ni.prototype,"disabled");customElements.get("violet-icon-button")||await f.define(ni,{name:"violet-icon-button",template:Wp,styles:qp,shadowOptions:{delegatesFocus:!0}});var Js=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Up=v`
    ${E}

    :host {
        display: block;
        color: var(--_text-primary);
        --_alert-radius: var(--violet-alert-radius, calc(var(--_radius-md) * 1.5));
        --_alert-padding: var(--violet-alert-padding, var(--_space-md));
        --_alert-gap: var(--violet-alert-gap, var(--_space-md));
        --_alert-icon-size: var(--violet-alert-icon-size, 1.125rem);
        --_alert-title-size: var(--violet-alert-title-size, var(--_body-size));
        --_alert-title-line: var(--violet-alert-title-line, var(--_body-line));
        --_alert-body-size: var(--violet-alert-body-size, var(--_body-size));
        --_alert-body-line: var(--violet-alert-body-line, var(--_body-line));
        --_alert-meta-size: var(--violet-alert-meta-size, var(--_caption-size));
        --_alert-border: var(--violet-alert-border, var(--_border-subtle));
        --_alert-surface: var(--violet-alert-surface, var(--_surface-card));
        --_alert-emphasis: var(--violet-alert-emphasis, var(--_text-secondary));
        --_alert-shadow: var(--violet-alert-shadow, none);
    }

    :host([tone="info"]) {
        --_alert-surface: color-mix(in srgb, var(--_surface-card) 72%, var(--_surface-subtle));
        --_alert-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
        --_alert-emphasis: var(--_text-secondary);
    }

    :host([tone="success"]) {
        --_alert-surface: var(--color-state-success-background, #E3F1E7);
        --_alert-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_alert-emphasis: var(--color-state-success-text, #166534);
    }

    :host([tone="warning"]) {
        --_alert-surface: var(--color-state-warning-background, #FDEBCC);
        --_alert-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_alert-emphasis: var(--color-state-warning-text, #92400E);
    }

    :host([tone="danger"]) {
        --_alert-surface: var(--color-state-danger-background, #FBE2E2);
        --_alert-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_alert-emphasis: var(--color-state-danger-text, #B42318);
    }

    .frame {
        --violet-card-radius: var(--_alert-radius);
        --violet-card-padding: var(--_alert-padding);
        --violet-card-background: var(--_alert-surface);
        --violet-card-border-color: var(--_alert-border);
        --violet-card-shadow: var(--_alert-shadow);
    }

    .layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--_alert-gap);
    }

    .leading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_alert-icon-size) + var(--_space-sm));
        block-size: calc(var(--_alert-icon-size) + var(--_space-sm));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, var(--_alert-emphasis) 12%, transparent);
        color: var(--_alert-emphasis);
        flex: 0 0 auto;
    }

    .leading[hidden] {
        display: none;
    }

    .leading ::slotted(violet-icon) {
        --violet-icon-size: var(--_alert-icon-size);
        color: currentColor;
    }

    .icon-slot {
        display: contents;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
        font-size: var(--_alert-body-size);
        line-height: var(--_alert-body-line);
    }

    .copy {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
    }

    .title {
        margin: 0;
        color: var(--_alert-emphasis);
        font-size: var(--_alert-title-size);
        line-height: var(--_alert-title-line);
        font-weight: 600;
    }

    .title[hidden] {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-2xs);
        color: var(--_text-primary);
    }

    .content slot::slotted(*) {
        margin: 0;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_space-sm);
        margin-block-start: var(--_space-stack-xs);
    }

    .actions[hidden] {
        display: none;
    }

    .actions slot::slotted(*) {
        margin: 0;
    }

    .dismiss {
        flex: 0 0 auto;
        margin-block-start: calc(var(--_space-stack-2xs) * -1);
        color: var(--_alert-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (max-width: 480px) {
        .layout {
            grid-template-columns: auto minmax(0, 1fr);
        }

        .dismiss {
            grid-column: 2;
            justify-self: end;
            margin-block-start: 0;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
        }

        .leading {
            background: Canvas;
            color: ButtonText;
            outline: 1px solid ButtonText;
        }
    }
`,Kp=u`
    <violet-card class="frame" part="root" appearance="outline" padding="medium">
        <div class="layout" part="layout">
            <span class="leading" part="icon" ?hidden="${t=>!t.showLeading}">
                <slot class="icon-slot" name="icon" @slotchange="${t=>t.handleIconSlotChange()}"></slot>
                ${t=>t.hasIcon?u``:t.defaultIconTemplate}
            </span>

            <div class="body" part="body">
                <div
                    class="copy"
                    part="copy"
                    role="${t=>t.liveRegionRole||null}"
                    aria-live="${t=>t.liveRegionPoliteness||null}"
                >
                    <p class="title" part="title" ?hidden="${t=>!t.hasTitle}">
                        <slot name="title" @slotchange="${t=>t.handleTitleSlotChange()}"></slot>
                    </p>
                    <div class="content" part="content">
                        <slot></slot>
                    </div>
                </div>
                <div class="actions" part="actions" ?hidden="${t=>!t.hasActions}">
                    <slot name="actions" @slotchange="${t=>t.handleActionsSlotChange()}"></slot>
                </div>
            </div>

            <violet-icon-button
                class="dismiss"
                part="dismiss-button"
                appearance="transparent"
                label="Dismiss alert"
                ?hidden="${t=>!t.dismissible}"
                @click="${t=>t.handleDismiss()}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`,xt=class extends f{constructor(){super(),this.hasTitle=!1,this.hasActions=!1,this.hasIcon=!1,this.tone="default",this.announcement="off",this.dismissible=!1}connectedCallback(){super.connectedCallback(),gt(),Ne(),Ae(),ii(),this.handleTitleSlotChange(),this.handleActionsSlotChange(),this.handleIconSlotChange()}get showLeading(){return this.hasIcon||this.tone==="success"||this.tone==="warning"||this.tone==="danger"}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}get defaultIconTemplate(){return this.tone==="success"?u`<violet-icon icon="system/checkmark" decorative></violet-icon>`:this.tone==="danger"?u`<violet-icon icon="system/dismiss" decorative></violet-icon>`:this.tone==="warning"?u`<violet-icon icon="system/warning" decorative></violet-icon>`:u``}handleTitleSlotChange(){this.hasTitle=this.#e('slot[name="title"]')}handleActionsSlotChange(){this.hasActions=this.#e('slot[name="actions"]')}handleIconSlotChange(){this.hasIcon=this.#e('slot[name="icon"]')}handleDismiss(){this.$emit("dismiss")}#e(e){return(this.shadowRoot?.querySelector(e)?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0)}};Js([m],xt.prototype,"hasTitle",void 0);Js([m],xt.prototype,"hasActions",void 0);Js([m],xt.prototype,"hasIcon",void 0);c(xt.prototype,"tone");c(xt.prototype,"announcement");c({mode:"boolean"})(xt.prototype,"dismissible");customElements.get("violet-alert")||await f.define(xt,{name:"violet-alert",template:Kp,styles:Up,shadowOptions:{delegatesFocus:!0}});var Gp=v`
    ${E}

    :host {
        display: inline-flex;
        --_badge-bg: var(--_surface-subtle);
        --_badge-text: var(--_text-secondary);
        --_badge-border: var(--_border-subtle);
        --_badge-padding-inline: var(--_space-md);
        --_badge-min-block: 1.25rem;
        --_badge-font-size: var(--_caption-size);
        --_badge-line-height: var(--_caption-line);
    }

    :host([size="sm"]) {
        --_badge-padding-inline: var(--_space-sm);
        --_badge-min-block: 1.125rem;
    }

    :host([size="md"]) {
        --_badge-padding-inline: var(--_space-md);
        --_badge-min-block: 1.25rem;
    }

    :host([size="lg"]) {
        --_badge-padding-inline: var(--_space-lg);
        --_badge-min-block: 1.5rem;
        --_badge-font-size: var(--_body-size);
        --_badge-line-height: var(--_body-line);
    }

    :host([color="accent"]) {
        --_badge-bg: var(--color-control-selected-background, #DDEADF);
        --_badge-text: var(--color-control-selected-foreground, #244635);
        --_badge-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
    }

    :host([color="success"]) {
        --_badge-bg: var(--color-state-success-background, #E3F1E7);
        --_badge-text: var(--color-state-success-text, #166534);
        --_badge-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
    }

    :host([color="warning"]) {
        --_badge-bg: var(--color-state-warning-background, #FDEBCC);
        --_badge-text: var(--color-state-warning-text, #92400E);
        --_badge-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
    }

    :host([color="danger"]) {
        --_badge-bg: var(--color-state-danger-background, #FBE2E2);
        --_badge-text: var(--color-state-danger-text, #B42318);
        --_badge-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .badge {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--_space-sm);
        min-block-size: var(--_badge-min-block);
        min-inline-size: var(--_badge-min-block);
        padding-inline: var(--_badge-padding-inline);
        border: 1px solid var(--_badge-border);
        border-radius: var(--_radius-round);
        background: var(--_badge-bg);
        color: var(--_badge-text);
        font-size: var(--_badge-font-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_badge-line-height);
        white-space: nowrap;
    }

    :host([appearance="outline"]) .badge {
        background: var(--_surface-page);
    }

    :host([appearance="subtle"]) .badge {
        background: color-mix(in srgb, var(--_badge-bg) 45%, var(--_surface-page));
        border-color: color-mix(in srgb, var(--_badge-border) 70%, transparent);
    }

    .content {
        display: inline-flex;
        align-items: center;
    }

    .content::slotted(*) {
        margin: 0;
    }

    violet-icon {
        --violet-icon-size: 0.9em;
    }

    @media (forced-colors: active) {
        .badge {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
        }
    }
`,Yp=u`
    <span class="badge" part="badge" aria-hidden="${t=>t.decorative?"true":"false"}">
        ${b(t=>!!t.icon,u`
                <violet-icon icon="${t=>t.icon}" decorative="true" part="icon"></violet-icon>
            `)}
        <span class="content" part="content">
            <slot></slot>
        </span>
    </span>
`,wt=class extends f{constructor(){super(),this.label="",this.appearance="filled",this.color="neutral",this.size="md",this.decorative=!1,this.icon=""}connectedCallback(){super.connectedCallback(),this.syncAccessibilityState()}decorativeChanged(){this.syncAccessibilityState()}labelChanged(){this.syncAccessibilityState()}syncAccessibilityState(){if(this.decorative){this.setAttribute("aria-hidden","true"),this.removeAttribute("aria-label"),this.removeAttribute("role");return}this.removeAttribute("aria-hidden");let e=(this.label??"").trim();if(e){this.setAttribute("role","img"),this.setAttribute("aria-label",e);return}this.removeAttribute("role"),this.removeAttribute("aria-label")}};c(wt.prototype,"appearance");c(wt.prototype,"color");c(wt.prototype,"size");c({mode:"boolean"})(wt.prototype,"decorative");c(wt.prototype,"icon");c(wt.prototype,"label");customElements.get("violet-badge")||await f.define(wt,{name:"violet-badge",template:Yp,styles:Gp});var Hl=0,Xp=v`
    ${E}

    :host {
        display: block;

        --_accordion-item-border-width: var(--violet-accordion-item-border-width, 1px);
        --_accordion-item-border-color: var(--violet-accordion-item-border-color, var(--_border-subtle));
        --_accordion-item-background: var(--violet-accordion-item-background, var(--_surface-page));
        --_accordion-item-background-hover: var(--violet-accordion-item-background-hover, var(--_surface-subtle));
        --_accordion-item-background-expanded: var(--violet-accordion-item-background-expanded, var(--_surface-card));
        --_accordion-item-padding-inline: var(--violet-accordion-item-padding-inline, var(--_space-md));
        --_accordion-item-padding-block: var(--violet-accordion-item-padding-block, var(--_space-sm));
        --_accordion-item-gap: var(--violet-accordion-item-gap, var(--_space-sm));
    }

    :host(:first-of-type) .item {
        border-start-start-radius: var(--_radius-md);
        border-start-end-radius: var(--_radius-md);
    }

    :host(:last-of-type) .item {
        border-end-start-radius: var(--_radius-md);
        border-end-end-radius: var(--_radius-md);
    }

    .item {
        border: var(--_accordion-item-border-width) solid var(--_accordion-item-border-color);
        background: var(--_accordion-item-background);
        overflow: clip;
    }

    :host(:not(:first-of-type)) .item {
        border-block-start-width: 0;
    }

    .heading {
        margin: 0;
    }

    .trigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_accordion-item-gap);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding: var(--_accordion-item-padding-block) var(--_accordion-item-padding-inline);
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: start;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        background: var(--_accordion-item-background-hover);
    }

    .trigger:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    :host([expanded]) .trigger {
        background: var(--_accordion-item-background-expanded);
    }

    :host([disabled]) .trigger {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.7;
    }

    .heading-content {
        min-inline-size: 0;
        font-size: var(--_control-body-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-body-line);
    }

    .indicator {
        inline-size: 0.625rem;
        block-size: 0.625rem;
        flex: 0 0 auto;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        opacity: 0.8;
        transform: rotate(45deg);
        transition: transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([expanded]) .indicator {
        transform: rotate(225deg);
    }

    .panel {
        border-block-start: var(--_accordion-item-border-width) solid var(--_accordion-item-border-color);
        background: var(--_accordion-item-background-expanded);
    }

    .panel[hidden] {
        display: none;
    }

    .panel-content {
        padding: var(--_space-md) var(--_accordion-item-padding-inline);
        color: var(--_text-secondary);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    @media (forced-colors: active) {
        .item {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
        }

        .trigger:focus-visible {
            box-shadow: inset 0 0 0 2px Highlight;
        }
    }
`,Qp=u`
    <div class="item" part="item">
        <div class="heading" part="heading" role="heading" aria-level="${t=>t.headingLevel}">
            <button
                class="trigger"
                part="trigger"
                id="${t=>t.buttonId}"
                type="button"
                ?disabled="${t=>t.disabled}"
                aria-expanded="${t=>String(t.expanded)}"
                aria-controls="${t=>t.panelId}"
                @click="${t=>t.handleTriggerClick()}"
            >
                <span class="heading-content" part="heading-content">
                    <slot name="heading"></slot>
                </span>
                <span class="indicator" part="indicator" aria-hidden="true"></span>
            </button>
        </div>
        <div
            class="panel"
            part="panel"
            id="${t=>t.panelId}"
            role="region"
            aria-labelledby="${t=>t.buttonId}"
            ?hidden="${t=>!t.expanded}"
        >
            <div class="panel-content" part="panel-content">
                <slot></slot>
            </div>
        </div>
    </div>
`,Ii=class extends f{constructor(){super();let e=Hl;Hl+=1,this.expanded=!1,this.disabled=!1,this.headingLevel=3,this.panelId=`violet-accordion-panel-${e}`,this.buttonId=`violet-accordion-button-${e}`}focusTrigger(){this.triggerElement?.focus()}handleTriggerClick(){this.disabled||this.$emit("toggle-request",{expanded:!this.expanded})}get triggerElement(){return this.shadowRoot?.querySelector(".trigger")??null}};c({mode:"boolean"})(Ii.prototype,"expanded");c({mode:"boolean"})(Ii.prototype,"disabled");c({attribute:"heading-level",converter:{fromView:t=>{let e=Number.parseInt(t,10);return Number.isFinite(e)&&e>=1&&e<=6?e:3},toView:t=>String(t)}})(Ii.prototype,"headingLevel");customElements.get("violet-accordion-item")||await f.define(Ii,{name:"violet-accordion-item",template:Qp,styles:Xp,shadowOptions:{delegatesFocus:!0}});var Jp=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Zp=v`
    ${E}

    :host {
        display: block;
    }

    .root {
        display: block;
    }
`,ef=u`
    <div class="root" part="root" @keydown="${(t,e)=>t.handleKeydown(e.event)}">
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </div>
`,Ir=class extends f{constructor(){super(),this.slottedItems=[],this.expandMode="multi"}connectedCallback(){super.connectedCallback(),this.addEventListener("toggle-request",this.handleToggleRequest),this.syncItems()}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("toggle-request",this.handleToggleRequest)}handleSlotChange(){let e=this.shadowRoot?.querySelector("slot");this.slottedItems=e?.assignedElements({flatten:!0})??[],this.syncItems()}handleToggleRequest(e){let i=e.target;if(!(i instanceof HTMLElement)||!this.items.includes(i))return;let r=e.detail?.expanded??!i.hasAttribute("expanded");if(this.expandMode==="single"&&r)for(let o of this.items)o!==i&&(o.expanded=!1);i.expanded=r,this.$emit("change",{item:i,expanded:r})}handleKeydown(e){let i=e.composedPath().find(s=>s instanceof HTMLElement&&s.tagName.toLowerCase()==="violet-accordion-item");if(!i)return!0;let r=this.items.filter(s=>!s.disabled),o=r.indexOf(i);if(o<0)return!0;switch(e.key){case"ArrowDown":case"ArrowRight":return e.preventDefault(),r[(o+1)%r.length]?.focusTrigger(),!1;case"ArrowUp":case"ArrowLeft":return e.preventDefault(),r[(o-1+r.length)%r.length]?.focusTrigger(),!1;case"Home":return e.preventDefault(),r[0]?.focusTrigger(),!1;case"End":return e.preventDefault(),r.at(-1)?.focusTrigger(),!1}return!0}get items(){return Array.from(this.querySelectorAll("violet-accordion-item")).filter(e=>e.closest("violet-accordion")===this)}syncItems(){let e=this.items;this.expandMode==="single"&&e.filter(r=>r.expanded).slice(1).forEach(r=>{r.expanded=!1})}};Jp([m],Ir.prototype,"slottedItems",void 0);c({attribute:"expand-mode"})(Ir.prototype,"expandMode");customElements.get("violet-accordion")||await f.define(Ir,{name:"violet-accordion",template:ef,styles:Zp});var tf=new Set(["http:","https:","mailto:"]),rf="http://violet.invalid/";function ko(t){if(!t)return!1;try{return tf.has(new URL(t,rf).protocol)}catch{return!1}}var of=v`
    ${E}

    :host {
        display: inline-flex;
        align-items: center;
        gap: 0;
        color: var(--_text-secondary);
        font-size: var(--_caption-size);
        line-height: var(--_caption-line);
    }

    .link,
    .label,
    .current {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        color: inherit;
        font: inherit;
        text-decoration: none;
    }

    .link {
        border-radius: var(--_radius-sm);
        transition:
            color var(--_duration-fast) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .link:hover {
        color: var(--_text-primary);
        background: var(--_surface-hover);
    }

    .link:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .current {
        color: var(--_text-primary);
        font-weight: 500;
    }

    .separator {
        color: var(--_text-muted);
        margin-inline: var(--_space-stack-2xs);
    }

    :host([current]) .separator {
        display: none;
    }
`,sf=u`
    ${t=>t.current?u`
                  <span class="current" part="current" aria-current="page">
                      <slot></slot>
                  </span>
              `:ko(t.href)?u`
                    <a class="link" part="link" href="${e=>e.href}">
                        <slot></slot>
                    </a>
                `:u`
                  <span class="label" part="label">
                      <slot></slot>
                  </span>
              `}
    <span class="separator" part="separator" aria-hidden="true">
        <slot name="separator">/</slot>
    </span>
`,Ar=class extends f{#e;constructor(){super(),this.#e=this.attachInternals(),this.href="",this.current=!1}connectedCallback(){super.connectedCallback(),this.#t()}currentChanged(){this.#t()}#t(){this.#e.role="listitem",this.#e.ariaCurrent=this.current?"page":null,this.$fastController.isConnected&&(this.setAttribute("role","listitem"),this.current?this.setAttribute("aria-current","page"):this.removeAttribute("aria-current"))}};c(Ar.prototype,"href");c({mode:"boolean"})(Ar.prototype,"current");customElements.get("violet-breadcrumb-item")||await f.define(Ar,{name:"violet-breadcrumb-item",template:sf,styles:of});var nf=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},af=v`
    ${E}

    :host {
        display: block;
    }

    .nav {
        display: block;
    }

    .list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0;
        margin: 0;
        padding: 0;
        list-style: none;
    }
`,lf=u`
    <nav class="nav" part="nav" aria-label="${t=>t.label||"Breadcrumb"}">
        <div class="list" part="list" role="list">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
    </nav>
`,Rr=class extends f{constructor(){super(),this.items=[]}connectedCallback(){super.connectedCallback(),this.#i(),this.handleSlotChange()}handleSlotChange(){this.items=this.#e(),this.#t()}labelChanged(){this.#i()}#e(){return Array.from(this.querySelectorAll("violet-breadcrumb-item")).filter(e=>e.closest("violet-breadcrumb")===this)}#t(){let e=this.items.filter(r=>r.current),i=e[e.length-1]??this.items[this.items.length-1]??null;this.items.forEach(r=>{r.current=r===i})}#i(){this.ariaLabel=this.label||"Breadcrumb"}};nf([m],Rr.prototype,"items",void 0);c(Rr.prototype,"label");customElements.get("violet-breadcrumb")||await f.define(Rr,{name:"violet-breadcrumb",template:lf,styles:af});function cf(t){return getComputedStyle(t).direction==="rtl"}function Le(t,e){return t!=="ArrowLeft"&&t!=="ArrowRight"||!cf(e)?t:t==="ArrowLeft"?"ArrowRight":"ArrowLeft"}function _t(t,e,i){return new Date(t,e,i,12,0,0,0)}function ze(t){if(!t)return null;let e=/^(\d{4})-(\d{2})-(\d{2})$/.exec(t.trim());if(!e)return null;let i=Number(e[1]),r=Number(e[2]),o=Number(e[3]),s=_t(i,r-1,o);return Number.isNaN(s.getTime())||s.getFullYear()!==i||s.getMonth()!==r-1||s.getDate()!==o?null:s}function qt(t){let e=t.getFullYear(),i=String(t.getMonth()+1).padStart(2,"0"),r=String(t.getDate()).padStart(2,"0");return`${e}-${i}-${r}`}function ot(t,e){let i=_t(t.getFullYear(),t.getMonth(),t.getDate());return i.setDate(i.getDate()+e),_t(i.getFullYear(),i.getMonth(),i.getDate())}function Ai(t,e){let i=t.getFullYear(),r=t.getMonth(),o=_t(i,r+e,1),s=Math.min(t.getDate(),uf(o.getFullYear(),o.getMonth()));return _t(o.getFullYear(),o.getMonth(),s)}function Zs(t,e){return Ai(t,e*12)}function df(t){return _t(t.getFullYear(),t.getMonth(),1)}function uf(t,e){return _t(t,e+1,0).getDate()}function ql(t,e,i){let r=qt(t);return e&&r<e?ze(e)??t:i&&r>i?ze(i)??t:t}function Wl(t,e){return t.localeCompare(e)}function Ul(t,e){if(typeof e=="number"&&e>=0&&e<=6)return e;try{let r=new Intl.Locale(t||"en-US").getWeekInfo?.();if(r&&typeof r.firstDay=="number")return r.firstDay%7}catch{}return 0}function Kl(t,e){let i=new Intl.DateTimeFormat(t||void 0,{weekday:"short"}),r=new Intl.DateTimeFormat(t||void 0,{weekday:"long"}),o=_t(2026,0,4);return Array.from({length:7},(s,n)=>{let a=ot(o,(e+n)%7);return{short:i.format(a),long:r.format(a)}})}function Gl(t,e){return new Intl.DateTimeFormat(t||void 0,{month:"long",year:"numeric"}).format(e)}function Fr(t,e){let i=ze(e);return i?new Intl.DateTimeFormat(t||void 0,{dateStyle:"medium"}).format(i):e}function Yl(t){let{locale:e,monthDate:i,weekStartDay:r,value:o="",start:s="",end:n="",focused:a="",min:l="",max:d="",disabledDate:h=null}=t,p=df(i),x=(p.getDay()-r+7)%7,k=ot(p,-x),S=qt(_t(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()));return Array.from({length:6},(A,D)=>Array.from({length:7},(_,T)=>{let I=ot(k,D*7+T),M=qt(I),V=!!(l&&M<l||d&&M>d||h?.(M)),O=!!(s&&n&&M>=s&&M<=n),j=o===M||s===M||n===M;return{iso:M,label:new Intl.DateTimeFormat(e||void 0,{day:"numeric"}).format(I),day:I.getDate(),currentMonth:I.getMonth()===i.getMonth(),disabled:V,selected:j,rangeStart:s===M,rangeEnd:n===M,inRange:O,today:S===M,tabIndex:a?a===M?0:-1:o===M?0:-1}}))}function en(t){if(!t)return null;let e=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());if(!e)return null;let i=Number(e[1]),r=Number(e[2]),o=Number(e[3]??"0");return i>23||r>59||o>59?null:{hour:i,minute:r,second:o}}var tn=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},hf=v`
    ${E}

    :host {
        display: grid;
        inline-size: min(100%, var(--violet-calendar-inline-size, 18rem));
        color: var(--_text-primary);
        --_calendar-radius: calc(var(--_radius-md) * 2);
        --_calendar-cell-size: clamp(2rem, 6vw, 2.25rem);
        --_calendar-accent: var(--color-state-success-foreground, #245c36);
        --_calendar-accent-soft: color-mix(in srgb, var(--_calendar-accent) 16%, transparent);
    }

    .root {
        display: grid;
        gap: var(--_space-md);
        padding: var(--_space-md);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_calendar-radius);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-card);
    }

    .header {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-sm);
    }

    .heading {
        justify-self: center;
        font-size: var(--_body-size);
        font-weight: 600;
        line-height: var(--_body-line);
    }

    .nav {
        box-sizing: border-box;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_calendar-cell-size);
        block-size: var(--_calendar-cell-size);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-round);
        background: var(--_surface-card);
        color: inherit;
        font: inherit;
        cursor: pointer;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    .nav:hover {
        background: var(--_surface-hover);
    }

    .nav:focus-visible,
    .day-button:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    .weekday-row,
    .week {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 2px;
    }

    .weekday {
        display: grid;
        place-items: center;
        block-size: calc(var(--_calendar-cell-size) * 0.75);
        color: var(--_text-muted);
        font-size: var(--_caption-size);
        line-height: var(--_caption-line);
    }

    .day-cell {
        display: grid;
    }

    .day-cell.range {
        background: var(--_calendar-accent-soft);
    }

    .day-button {
        box-sizing: border-box;
        display: inline-grid;
        place-items: center;
        inline-size: 100%;
        block-size: var(--_calendar-cell-size);
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--_radius-round);
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-size: var(--_body-size);
        line-height: 1;
    }

    .day-button.current-month {
        color: var(--_text-primary);
    }

    .day-button.other-month {
        color: var(--_text-muted);
    }

    .day-button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--_calendar-accent) 10%, transparent);
    }

    .day-button.selected {
        background: var(--_calendar-accent);
        color: white;
    }

    .day-button.range-start,
    .day-button.range-end {
        background: var(--_calendar-accent);
        color: white;
    }

    .day-button.today:not(.selected):not(.range-start):not(.range-end) {
        border-color: color-mix(in srgb, var(--_calendar-accent) 35%, transparent);
    }

    .day-button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }

    @media (forced-colors: active) {
        .root,
        .nav,
        .day-button {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
            box-shadow: none;
        }

        .day-button.selected,
        .day-button.range-start,
        .day-button.range-end {
            background: Highlight;
            color: HighlightText;
            border-color: Highlight;
        }

        .day-cell.range {
            background: Canvas;
        }
    }
`,pf=u`
    <div class="root" part="root">
        <div class="header" part="header">
            <button class="nav" part="previous-month" type="button" ?disabled="${t=>t.disabled}" aria-label="Previous month" @click="${t=>t.showPreviousMonth()}">
                &lsaquo;
            </button>
            <div class="heading" part="heading" aria-live="polite">${t=>t.monthLabel}</div>
            <button class="nav" part="next-month" type="button" ?disabled="${t=>t.disabled}" aria-label="Next month" @click="${t=>t.showNextMonth()}">
                &rsaquo;
            </button>
        </div>
        <div class="weekday-row" part="weekday-row">
            ${L(t=>t.weekdayLabels,u`
                    <div class="weekday" part="weekday" abbr="${t=>t.long}" aria-label="${t=>t.long}">${t=>t.short}</div>
                `)}
        </div>
        <div
            class="grid"
            part="grid"
            role="grid"
            aria-label="${t=>t.monthLabel}"
            @focusin="${(t,e)=>t.handleGridFocusIn(e.event)}"
            @click="${(t,e)=>t.handleGridClick(e.event)}"
            @keydown="${(t,e)=>t.handleGridKeydown(e.event)}"
        >
            ${L(t=>t.weeks,u`
                    <div class="week" part="week" role="row">
                        ${L(t=>t,u`
                                <div class="${t=>`day-cell${t.inRange?" range":""}`}" part="day-cell" role="gridcell" aria-selected="${t=>String(t.selected)}">
                                    <button
                                        class="${t=>["day-button",t.currentMonth?"current-month":"other-month",t.selected?"selected":"",t.rangeStart?"range-start":"",t.rangeEnd?"range-end":"",t.today?"today":""].filter(Boolean).join(" ")}"
                                        part="day-button"
                                        type="button"
                                        data-date="${t=>t.iso}"
                                        tabindex="${t=>String(t.tabIndex)}"
                                        ?disabled="${t=>t.disabled}"
                                        aria-label="${t=>t.label}"
                                    >
                                        ${t=>t.day}
                                    </button>
                                </div>
                            `)}
                    </div>
                `)}
        </div>
    </div>
`,Se=class extends f{constructor(){super(),this.disabledDates=null,this.locale="",this.selectionMode="single",this.value="",this.start="",this.end="",this.min="",this.max="",this.disabled=!1,this.weekStartDay=-1;let e=new Date;this.monthDate=new Date(e.getFullYear(),e.getMonth(),1,12,0,0,0),this.focusedDate=qt(new Date(e.getFullYear(),e.getMonth(),e.getDate(),12,0,0,0))}connectedCallback(){super.connectedCallback(),this.#e(),this.#t()}get resolvedLocale(){return this.locale||document.documentElement.lang||navigator.language||"en-US"}get resolvedWeekStartDay(){return Ul(this.resolvedLocale,this.weekStartDay>=0?this.weekStartDay:void 0)}get weekdayLabels(){return Kl(this.resolvedLocale,this.resolvedWeekStartDay)}get monthLabel(){return Gl(this.resolvedLocale,this.monthDate)}get weeks(){return Yl({locale:this.resolvedLocale,monthDate:this.monthDate,weekStartDay:this.resolvedWeekStartDay,value:this.selectionMode==="single"?this.value:"",start:this.selectionMode==="range"?this.start:"",end:this.selectionMode==="range"?this.end:"",focused:this.focusedDate,min:this.min,max:this.max,disabledDate:this.disabled?()=>!0:this.disabledDates})}valueChanged(){this.selectionMode==="single"&&(this.#e(),this.#t())}startChanged(){this.selectionMode==="range"&&(this.#e(),this.#t())}endChanged(){this.selectionMode==="range"&&this.#t()}localeChanged(){this.$emit("locale-change",{locale:this.resolvedLocale})}showPreviousMonth(){this.monthDate=Ai(this.monthDate,-1),this.#i()}showNextMonth(){this.monthDate=Ai(this.monthDate,1),this.#i()}handleDayFocus(e){this.focusedDate=e}handleDayFocusEvent(e){let r=e.currentTarget?.getAttribute("data-date")??"";r&&this.handleDayFocus(r)}handleGridFocusIn(e){let r=e.target?.closest("[data-date]")?.getAttribute("data-date")??"";r&&this.handleDayFocus(r)}handleDaySelect(e){if(!(this.disabled||this.#n(e))){if(this.selectionMode==="range"){!this.start||this.start&&this.end?(this.start=e,this.end=""):Wl(e,this.start)<0?(this.start=e,this.end=""):this.end=e,this.focusedDate=e,this.$emit("input",{start:this.start||null,end:this.end||null}),this.$emit("change",{start:this.start||null,end:this.end||null});return}this.value=e,this.focusedDate=e,this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value})}}handleDaySelectEvent(e){let r=e.currentTarget?.getAttribute("data-date")??"";r&&this.handleDaySelect(r)}handleGridClick(e){let r=e.target?.closest("[data-date]")?.getAttribute("data-date")??"";r&&this.handleDaySelect(r)}handleGridKeydown(e){if(this.disabled)return!0;let i=ze(this.focusedDate)??ze(this.value)??ze(this.start)??new Date,r=null;switch(Le(e.key,this)){case"ArrowLeft":r=ot(i,-1);break;case"ArrowRight":r=ot(i,1);break;case"ArrowUp":r=ot(i,-7);break;case"ArrowDown":r=ot(i,7);break;case"Home":r=ot(i,-((i.getDay()-this.resolvedWeekStartDay+7)%7));break;case"End":r=ot(i,6-(i.getDay()-this.resolvedWeekStartDay+7)%7);break;case"PageUp":r=e.shiftKey?Zs(i,-1):Ai(i,-1);break;case"PageDown":r=e.shiftKey?Zs(i,1):Ai(i,1);break;case"Enter":case" ":return e.preventDefault(),this.handleDaySelect(this.focusedDate),!1;default:return!0}e.preventDefault();let o=ql(r??i,this.min,this.max);return this.focusedDate=qt(o),this.monthDate=new Date(o.getFullYear(),o.getMonth(),1,12,0,0,0),requestAnimationFrame(()=>this.#r()),!1}#e(){let e=ze(this.selectionMode==="range"?this.start:this.value);e&&(this.monthDate=new Date(e.getFullYear(),e.getMonth(),1,12,0,0,0))}#t(){let e=this.selectionMode==="range"?this.end||this.start:this.value;if(e){this.focusedDate=e;return}if(!ze(this.focusedDate)){let i=new Date;this.focusedDate=qt(new Date(i.getFullYear(),i.getMonth(),i.getDate(),12,0,0,0))}}#i(){let e=ze(this.focusedDate);e&&((e.getMonth()!==this.monthDate.getMonth()||e.getFullYear()!==this.monthDate.getFullYear())&&(this.focusedDate=qt(new Date(this.monthDate.getFullYear(),this.monthDate.getMonth(),1,12,0,0,0))),requestAnimationFrame(()=>this.#r()))}#r(){this.shadowRoot?.querySelector(`[data-date="${this.focusedDate}"]`)?.focus()}#n(e){return!!(this.min&&e<this.min||this.max&&e>this.max||this.disabledDates?.(e))}};tn([m],Se.prototype,"monthDate",void 0);tn([m],Se.prototype,"focusedDate",void 0);tn([m],Se.prototype,"weekStartDay",void 0);c({attribute:"selection-mode"})(Se.prototype,"selectionMode");c(Se.prototype,"locale");c(Se.prototype,"value");c(Se.prototype,"start");c(Se.prototype,"end");c(Se.prototype,"min");c(Se.prototype,"max");c({mode:"boolean"})(Se.prototype,"disabled");customElements.get("violet-calendar")||await f.define(Se,{name:"violet-calendar",template:pf,styles:hf});var ff=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Ql={fromView(t){let e=Number.parseInt(t,10);return Number.isFinite(e)?e:0},toView(t){return String(t)}};function Xl(t,e,i){let r=t.getAttribute(e);if(!r)return i;let o=Number.parseInt(r,10);return Number.isFinite(o)?o:i}Be();var mf=v`
    ${E}

    :host {
        display: block;
        min-inline-size: 0;
        color: var(--_text-primary);

        --_carousel-gap: var(--_space-md);
        --_carousel-slide-gap: var(--_space-sm);
        --_carousel-slides-per-view: 1;
        --_carousel-radius: calc(var(--_radius-md) * 2);
        --_carousel-surface: var(--_surface-card);
        --_carousel-border: var(--_border-subtle);
        --_carousel-shadow: var(--_shadow-card);
        --_carousel-dot-size: 0.625rem;
        --_carousel-dot-active: var(--color-state-success-foreground, #245c36);
        --_carousel-dot-idle: color-mix(in srgb, var(--_text-muted) 32%, transparent);
    }

    :host([appearance="plain"]) {
        --_carousel-surface: transparent;
        --_carousel-border: transparent;
        --_carousel-shadow: none;
    }

    .root {
        display: grid;
        gap: var(--_carousel-gap);
    }

    .viewport {
        box-sizing: border-box;
        overflow-x: auto;
        overflow-y: hidden;
        min-inline-size: 0;
        border: 1px solid var(--_carousel-border);
        border-radius: var(--_carousel-radius);
        background: var(--_carousel-surface);
        box-shadow: var(--_carousel-shadow);
        scroll-behavior: smooth;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
    }

    .viewport::-webkit-scrollbar {
        display: none;
    }

    .viewport:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
    }

    .track {
        display: block;
        min-inline-size: 0;
    }

    .slides {
        display: flex;
        gap: var(--_carousel-slide-gap);
        min-inline-size: 100%;
    }

    ::slotted(*) {
        box-sizing: border-box;
        flex: 0 0 calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        min-inline-size: calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        inline-size: calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        scroll-snap-align: start;
        scroll-snap-stop: always;
    }

    .controls {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
    }

    .controls[hidden],
    .pagination[hidden],
    .status[hidden] {
        display: none;
    }

    .previous-button violet-icon {
        transform: rotate(180deg);
    }

    .pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
        flex-wrap: wrap;
    }

    .dot {
        box-sizing: border-box;
        inline-size: calc(var(--_target-size) * 0.75);
        block-size: calc(var(--_target-size) * 0.75);
        min-inline-size: calc(var(--_target-size) * 0.75);
        min-block-size: calc(var(--_target-size) * 0.75);
        padding: 0;
        border: 0;
        border-radius: var(--_radius-round);
        background: transparent;
        color: inherit;
        display: inline-grid;
        place-items: center;
        cursor: pointer;
    }

    .dot::before {
        content: "";
        inline-size: var(--_carousel-dot-size);
        block-size: var(--_carousel-dot-size);
        border-radius: var(--_radius-round);
        background: var(--_carousel-dot-idle);
        transition:
            transform var(--_duration-fast) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    .dot:hover::before {
        transform: scale(1.08);
    }

    .dot[aria-pressed="true"]::before {
        background: var(--_carousel-dot-active);
        transform: scale(1.2);
    }

    .dot:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
    }

    .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
        .viewport {
            scroll-behavior: auto;
        }
    }

    @media (forced-colors: active) {
        .viewport {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }

        .dot::before {
            background: GrayText;
        }

        .dot[aria-pressed="true"]::before {
            background: Highlight;
        }
    }
`,gf=u`
    <section class="root" part="root" role="region" aria-roledescription="carousel" aria-label="${t=>t.label}">
        <div
            class="viewport"
            part="viewport"
            tabindex="0"
            @scroll="${t=>t.handleViewportScroll()}"
            @keydown="${(t,e)=>t.handleViewportKeydown(e.event)}"
        >
            <div class="track" part="track">
                <slot class="slides" @slotchange="${t=>t.handleSlidesSlotChange()}"></slot>
            </div>
        </div>

        <div class="controls" part="controls">
            <violet-icon-button
                class="previous-button"
                part="previous-button"
                appearance="quiet"
                label="Previous slide"
                @click="${t=>t.previous()}"
            >
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </violet-icon-button>

            <div class="pagination" part="pagination" role="group" aria-label="${t=>`${t.label} slide navigation`}"></div>

            <violet-icon-button
                class="next-button"
                part="next-button"
                appearance="quiet"
                label="Next slide"
                @click="${t=>t.next()}"
            >
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </violet-icon-button>
        </div>

        <div class="status sr-only" part="status" aria-live="polite" aria-atomic="true"></div>
    </section>
`,kt=class extends f{#e=!1;#t=!1;#i=0;constructor(){super(),this.slides=[],this.slideCount=0,this.appearance="framed",this.label="Carousel",this.activeIndex=0,this.slidesPerView=1,this.loop=!1}connectedCallback(){super.connectedCallback(),this.activeIndex=Xl(this,"active-index",this.activeIndex||0),this.slidesPerView=Xl(this,"slides-per-view",this.slidesPerView||1),requestAnimationFrame(()=>{this.isConnected&&(this.#e=!0,this.#r(),this.#n({scroll:!1,emit:!1}))})}disconnectedCallback(){super.disconnectedCallback(),this.#e=!1,this.#i&&(cancelAnimationFrame(this.#i),this.#i=0)}activeIndexChanged(){this.#e&&this.#n({scroll:!this.#t,emit:!0})}slidesPerViewChanged(){this.#e&&this.#n({scroll:!1,emit:!1})}handleSlidesSlotChange(){this.#r(),this.#n({scroll:!1,emit:!1})}handleViewportScroll(){this.#i||(this.#i=requestAnimationFrame(()=>{this.#i=0;let e=this.#o();e!==this.activeIndex&&(this.#t=!0,this.activeIndex=e,this.#t=!1)}))}handleViewportKeydown(e){if(e.defaultPrevented||this.slides.length<2)return!0;switch(Le(e.key,this)){case"ArrowRight":return e.preventDefault(),this.next(),!1;case"ArrowLeft":return e.preventDefault(),this.previous(),!1;case"Home":return e.preventDefault(),this.goTo(0),!1;case"End":return e.preventDefault(),this.goTo(this.#d),!1;default:return!0}}goTo(e){let i=this.#l(e);i!==this.activeIndex&&(this.activeIndex=i)}next(){if(!(this.slides.length<2)){if(this.loop){this.goTo((this.activeIndex+1)%(this.#d+1));return}this.goTo(this.activeIndex+1)}}previous(){if(!(this.slides.length<2)){if(this.loop){this.goTo((this.activeIndex-1+this.#d+1)%(this.#d+1));return}this.goTo(this.activeIndex-1)}}get canGoPrevious(){return this.slideCount>1&&(this.loop||this.activeIndex>0)}get canGoNext(){return this.slideCount>1&&(this.loop||this.activeIndex<this.#d)}get currentSlideStatus(){if(this.slideCount<1)return"";let e=this.#l(this.activeIndex),i=this.#c,r=Math.min(this.slideCount,e+i),o=this.slides[e];return i===1?`${o?.label??`Slide ${e+1}`} (${e+1} of ${this.slideCount})`:`Showing slides ${e+1} through ${r} of ${this.slideCount}`}#r(){let e=this.slideElements;e.forEach((i,r)=>{i.dataset.carouselIndex=String(r),i.dataset.carouselLabel=this.#a(i,r)}),this.slides=e.map((i,r)=>({index:r,label:i.dataset.carouselLabel??`Slide ${r+1}`})),this.slideCount=this.slides.length,this.#h(),this.#f()}#n(e){let i=this.#l(this.activeIndex);if(i!==this.activeIndex){this.activeIndex=i;return}let r=this.slideElements,o=r[i]??null;r.forEach((s,n)=>{let a=n>=i&&n<i+this.#c;s.toggleAttribute("data-active",a),s.toggleAttribute("inert",!a),s.setAttribute("aria-hidden",String(!a))}),this.#p(),this.#f(),e.scroll&&o&&this.#s(o),e.emit&&o&&(this.$emit("slide-change",{activeIndex:i,slide:o}),this.$emit("change"))}#s(e){let i=this.viewportElement;if(!i)return;let r=e.offsetLeft;if(typeof i.scrollTo=="function"){i.scrollTo({left:r,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});return}i.scrollLeft=r}#o(){let e=this.viewportElement,i=this.slideElements;if(!e||i.length<2)return 0;let r=e.scrollLeft,o=0,s=Number.POSITIVE_INFINITY;return i.forEach((n,a)=>{let l=Math.abs(n.offsetLeft-r);l<s&&(s=l,o=a)}),o}#a(e,i){return e.getAttribute("data-label")??e.getAttribute("aria-label")??e.getAttribute("title")??`Slide ${i+1}`}#l(e){return this.slideCount<1?0:Math.max(0,Math.min(e,this.#d))}get#c(){return this.slideCount<1?Math.max(1,this.slidesPerView||1):Math.max(1,Math.min(this.slidesPerView||1,this.slideCount))}get#d(){return Math.max(0,this.slideCount-this.#c)}get#u(){return Array.from({length:this.#d+1},(e,i)=>i)}#h(){let e=this.paginationElement;e&&(e.replaceChildren(),this.#u.forEach(i=>{let r=document.createElement("button");r.className="dot",r.part.add("dot"),r.type="button";let o=i+1,s=Math.min(this.slideCount,i+this.#c);r.setAttribute("aria-label",this.#c===1?`Go to ${this.slides[i]?.label??`slide ${o}`}`:`Go to slides ${o} through ${s}`),r.addEventListener("click",()=>{this.goTo(i)}),e.append(r)}),this.#p())}#p(){Array.from(this.shadowRoot?.querySelectorAll(".dot")??[]).forEach((i,r)=>{i.setAttribute("aria-pressed",String(this.#u[r]===this.activeIndex))})}#f(){this.style.setProperty("--_carousel-slides-per-view",String(this.#c));let e=this.#d>0,i=this.controlsElement;i&&(i.hidden=!e);let r=this.previousButtonElement;r&&(r.disabled=!this.canGoPrevious);let o=this.nextButtonElement;o&&(o.disabled=!this.canGoNext);let s=this.statusElement;s&&(s.hidden=!e,s.textContent=this.currentSlideStatus)}get viewportElement(){return this.shadowRoot?.querySelector(".viewport")??null}get paginationElement(){return this.shadowRoot?.querySelector(".pagination")??null}get controlsElement(){return this.shadowRoot?.querySelector(".controls")??null}get previousButtonElement(){return this.shadowRoot?.querySelector(".previous-button")}get nextButtonElement(){return this.shadowRoot?.querySelector(".next-button")}get statusElement(){return this.shadowRoot?.querySelector(".status")??null}get slideElements(){return(this.shadowRoot?.querySelector("slot")?.assignedElements({flatten:!0})??[]).filter(i=>i instanceof HTMLElement)}};ff([m],kt.prototype,"slideCount",void 0);c(kt.prototype,"appearance");c(kt.prototype,"label");c({attribute:"active-index",converter:Ql})(kt.prototype,"activeIndex");c({attribute:"slides-per-view",converter:Ql})(kt.prototype,"slidesPerView");c({mode:"boolean"})(kt.prototype,"loop");customElements.get("violet-carousel")||await f.define(kt,{name:"violet-carousel",template:gf,styles:mf,shadowOptions:{delegatesFocus:!0}});function rn(t){for(let e=t.parentElement;e;e=e.parentElement){if(!(e instanceof HTMLFieldSetElement)||!e.hasAttribute("disabled"))continue;if(!Array.from(e.children).find(r=>r instanceof HTMLLegendElement)?.contains(t))return!0}return!1}function q(t){let e=t,i=e.connectedCallback,r=e.disabledChanged;m(t,"fieldsetDisabled"),Object.defineProperty(t,"effectiveDisabled",{configurable:!0,get(){return!!this.disabled||!!this.fieldsetDisabled}}),Object.defineProperty(t,"formDisabledCallback",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=rn(this)}}),Object.defineProperty(t,"fieldsetDisabledChanged",{configurable:!0,writable:!0,value(){r?.call(this)}}),Object.defineProperty(t,"disabledChanged",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=rn(this),r?.call(this)}}),Object.defineProperty(t,"connectedCallback",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=rn(this),i?.call(this)}})}var Jl=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},vf=v`
    ${F}

    :host {
        display: inline-grid;

        --_selection-background: var(--color-control-selected-background, #ddeadf);
        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_selection-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_radius-sm: var(--radius-sm, 2px);
        --_size-font-md: var(--size-font-md, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-checkbox-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-checkbox-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: calc(var(--_space-inline-sm) * 2);
        align-items: start;
        min-block-size: var(--_target-size);
        cursor: pointer;
    }

    :host([inline]) .root {
        grid-template-columns: auto;
        gap: 0;
        align-items: center;
        min-block-size: auto;
    }

    .input {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        margin: 0;
        padding: 0;
        opacity: 0;
        overflow: hidden;
        border: 0;
        clip: rect(0 0 0 0);
        white-space: nowrap;
    }

    .control-shell {
        position: relative;
        display: inline-grid;
        min-block-size: var(--_target-size);
        align-items: center;
    }

    :host([inline]) .control-shell {
        min-block-size: auto;
        line-height: 0;
    }

    .box {
        position: relative;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-sm);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .checkmark,
    .mixed-mark {
        display: block;
        grid-area: 1 / 1;
        justify-self: center;
        align-self: center;
        background: var(--_selection-text);
        opacity: 0;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .checkmark {
        inline-size: calc(var(--_control-size) * 0.72);
        block-size: calc(var(--_control-size) * 0.72);
        clip-path: polygon(14% 44%, 0 59%, 37% 100%, 100% 16%, 84% 0, 35% 62%);
        transform: scale(0.7);
    }

    .mixed-mark {
        inline-size: calc(var(--_control-size) * 0.56);
        block-size: 2px;
        border-radius: 999px;
        transform: scaleX(0.7);
    }

    .input:checked + .box {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:checked + .box .checkmark {
        opacity: 1;
        transform: scale(1);
    }

    .input:indeterminate + .box {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:indeterminate + .box .mixed-mark {
        opacity: 1;
        transform: scaleX(1);
    }

    .input:focus-visible + .box {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .box {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host(:disabled) .root {
        cursor: not-allowed;
    }

    /* Supporting text often says why the control is unavailable, so it stays readable. */
    :host([disabled]) :is(.control-shell, .label),
    :host(:disabled) :is(.control-shell, .label) {
        opacity: 0.6;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_target-size);
        align-content: center;
        min-inline-size: 0;
    }

    .content[hidden] {
        display: none;
    }

    :host([inline]) .content {
        min-block-size: auto;
        align-content: center;
    }

    .label {
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .supporting {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    @media (forced-colors: active) {
        .box {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .checkmark,
        .mixed-mark {
            forced-color-adjust: none;
            background: HighlightText;
        }

        .input:checked + .box,
        .input:indeterminate + .box {
            border-color: Highlight;
            background: Highlight;
        }

        .input:focus-visible + .box {
            outline: 2px solid Highlight;
            outline-offset: 2px;
        }

        :host([disabled]) .box,
        :host(:disabled) .box {
            border-color: GrayText;
        }
    }
`,bf=u`
    <label class="root" part="root">
        <span class="control-shell">
            <input
                class="input"
                part="input"
                type="checkbox"
                :checked="${t=>t.checked}"
                name="${t=>t.name}"
                value="${t=>t.value}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-label="${t=>t.controlAriaLabel}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @change="${(t,e)=>t.handleChange(e.event)}"
            />
            <span class="box" part="control" aria-hidden="true">
                <span class="checkmark" part="mark checkmark"></span>
                <span class="mixed-mark" part="mark mixed-mark"></span>
            </span>
        </span>
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting}">
            <span class="label" part="label" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </span>
            <span class="supporting" part="supporting-text" ?hidden="${t=>!t.hasSupporting}">
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
        </span>
    </label>
`,$e=class extends f{static{this.formAssociated=!0}#e;#t;#i;constructor(){super(),this.#e=this.attachInternals(),this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.indeterminate=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.name="",this.value="on",this.required=!1,this.#t=!1,this.#i=!1}connectedCallback(){super.connectedCallback(),this.#t=this.hasAttribute("checked")?this.getAttribute("checked")!=="false":this.checked,this.#i=this.hasAttribute("indeterminate")?this.getAttribute("indeterminate")!=="false":this.indeterminate,this.#r(),this.#n(),this.#o(),this.#a()}handleChange(e){let i=e.currentTarget;this.checked=i?.checked??!1,this.indeterminate=!1,this.$emit("change",{checked:this.checked})}handleDefaultSlotChange(){this.#r()}handleSupportingSlotChange(){this.#n()}formStateRestoreCallback(e){(e==="checked"||e==="unchecked")&&(this.checked=e==="checked")}formResetCallback(){this.checked=this.#t,this.indeterminate=this.#i}get controlAriaLabel(){let e=this.getAttribute("aria-label");return e||this.#s()||null}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}checkedChanged(){this.#o(),this.#a()}indeterminateChanged(){this.#o(),this.#a()}disabledChanged(){this.#o(),this.#a()}invalidChanged(){this.#o(),this.#a()}requiredChanged(){this.#o(),this.#a()}valueChanged(){this.#o(),this.#a()}nameChanged(){this.#o()}#r(){this.hasLabel=this.#s().length>0}#n(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#s(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#o(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(!e)return;e.checked=this.checked,e.indeterminate=this.indeterminate,e.disabled=this.effectiveDisabled,e.required=this.required,e.name=this.name,e.value=this.value,e.setAttribute("aria-invalid",this.invalid?"true":"false");let i=this.controlAriaLabel;i?e.setAttribute("aria-label",i):e.removeAttribute("aria-label")}#a(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(!this.effectiveDisabled&&this.checked?this.value:null,this.checked?"checked":"unchecked"),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},"Please correct this field.",e??void 0);return}if(this.required&&!this.checked){this.#e.setValidity({valueMissing:!0},"Please select this option.",e??void 0);return}this.#e.setValidity({})}};Jl([m],$e.prototype,"hasSupporting",void 0);Jl([m],$e.prototype,"hasLabel",void 0);c({mode:"boolean"})($e.prototype,"checked");c({mode:"boolean"})($e.prototype,"indeterminate");c({mode:"boolean"})($e.prototype,"disabled");q($e.prototype);c({mode:"boolean"})($e.prototype,"inline");c({mode:"boolean"})($e.prototype,"invalid");c($e.prototype,"name");c($e.prototype,"value");c({mode:"boolean"})($e.prototype,"required");customElements.get("violet-checkbox")||await f.define($e,{name:"violet-checkbox",template:bf,styles:vf,shadowOptions:{delegatesFocus:!0}});var yf=/^#?([\da-f]{3}|[\da-f]{6})$/i;function st(t,e,i){return Math.min(i,Math.max(e,t))}function nt(t){let e=t.trim(),i=yf.exec(e);if(!i)return null;let r=i[1].toLowerCase();return r.length===3?`#${r.split("").map(o=>`${o}${o}`).join("")}`:`#${r}`}function xf(t){return`#${[t.r,t.g,t.b].map(e=>st(Math.round(e),0,255).toString(16).padStart(2,"0")).join("")}`}function wf(t){let e=nt(t);return e?{r:Number.parseInt(e.slice(1,3),16),g:Number.parseInt(e.slice(3,5),16),b:Number.parseInt(e.slice(5,7),16)}:null}function _f(t){let e=st(t.r,0,255)/255,i=st(t.g,0,255)/255,r=st(t.b,0,255)/255,o=Math.max(e,i,r),s=Math.min(e,i,r),n=o-s,a=0,l=(o+s)/2;if(n>0)switch(o){case e:a=((i-r)/n+(i<r?6:0))*60;break;case i:a=((r-e)/n+2)*60;break;default:a=((e-i)/n+4)*60;break}let d=n===0?0:n/(1-Math.abs(2*l-1));return{h:Math.round((a%360+360)%360),s:Math.round(d*100),l:Math.round(l*100)}}function on(t,e,i){let r=i;return r<0&&(r+=1),r>1&&(r-=1),r<1/6?t+(e-t)*6*r:r<1/2?e:r<2/3?t+(e-t)*(2/3-r)*6:t}function kf(t){let e=(t.h%360+360)%360/360,i=st(t.s,0,100)/100,r=st(t.l,0,100)/100;if(i===0){let n=Math.round(r*255);return{r:n,g:n,b:n}}let o=r<.5?r*(1+i):r+i-r*i,s=2*r-o;return{r:Math.round(on(s,o,e+1/3)*255),g:Math.round(on(s,o,e)*255),b:Math.round(on(s,o,e-1/3)*255)}}function Zl(t){let e=wf(t);return e?_f(e):null}function Wt(t){return xf(kf(t))}function ec(t,e){return`linear-gradient(90deg, ${Wt({h:t,s:0,l:e})} 0%, ${Wt({h:t,s:100,l:e})} 100%)`}function tc(t,e){return`linear-gradient(90deg, ${Wt({h:t,s:e,l:0})} 0%, ${Wt({h:t,s:e,l:50})} 50%, ${Wt({h:t,s:e,l:100})} 100%)`}var Cf=v`
    ${E}

    :host {
        display: inline-grid;
        color: inherit;
    }

    :host([size="compact"]) {
        --_swatch-size: 1rem;
    }

    :host([size="natural"]) {
        --_swatch-size: 1.25rem;
    }

    :host([size="comfortable"]) {
        --_swatch-size: 1.5rem;
    }

    .swatch {
        position: relative;
        inline-size: var(--_swatch-size, 1.25rem);
        block-size: var(--_swatch-size, 1.25rem);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, white 24%, transparent);
        overflow: hidden;
        background:
            linear-gradient(45deg, color-mix(in srgb, var(--_text-primary) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--_text-primary) 6%, transparent) 75%),
            linear-gradient(45deg, color-mix(in srgb, var(--_text-primary) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--_text-primary) 6%, transparent) 75%),
            var(--_swatch-color, transparent);
        background-position:
            0 0,
            0.375rem 0.375rem,
            0 0;
        background-size:
            0.75rem 0.75rem,
            0.75rem 0.75rem,
            auto;
    }

    :host([shape="circle"]) .swatch {
        border-radius: var(--_radius-round);
    }
`,zf=u`
    <span
        class="swatch"
        part="swatch"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-label="${t=>t.decorative?null:t.ariaLabel}"
        style="${t=>`--_swatch-color: ${t.normalizedValue||"transparent"};`}"
    ></span>
`,Ut=class extends f{constructor(){super(),this.value="",this.label="",this.decorative=!1,this.shape="square",this.size="natural"}get normalizedValue(){return nt(this.value)??""}get ariaLabel(){return this.label||this.normalizedValue||"No color selected"}};c(Ut.prototype,"value");c(Ut.prototype,"label");c({mode:"boolean"})(Ut.prototype,"decorative");c(Ut.prototype,"shape");c(Ut.prototype,"size");customElements.get("violet-color-swatch")||await Ut.define({name:"violet-color-swatch",template:zf,styles:Cf});var Sf="#c84f3b",$f=["#244635","#c84f3b","#df7f44","#d2b062","#7c9d83","#5f7ea6","#7d5fa6","#b95a7b"],ic=0;Be();var Ef=v`
    ${F}

    :host {
        position: relative;
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .trigger {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-md);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_space-stack-xs) + 2px);
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: inherit;
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        border-color: var(--_field-border-hover);
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .trigger,
    :host(:disabled) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger,
    :host([data-invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .swatch {
        flex: 0 0 auto;
    }

    .trigger-copy {
        display: grid;
        gap: 1px;
        min-inline-size: 0;
    }

    .trigger-value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        color: var(--color-text-primary, #18181b);
    }

    .trigger-value.placeholder {
        color: var(--_text-muted);
    }

    .trigger-meta {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .trigger-icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
        transition: transform var(--_duration-base) var(--_easing-standard);
    }

    .control-shell.open .trigger-icon {
        transform: rotate(90deg);
    }

    .trigger-icon violet-icon {
        --violet-icon-size: 1rem;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        inline-size: min(26rem, calc(100vw - 8px));
        max-inline-size: calc(100vw - 16px);
        padding: var(--_space-stack-sm);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 2);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-floating);
        color: inherit;
        z-index: var(--_layer-popover);
        gap: var(--_space-stack-sm);
        opacity: 0;
        transform: translateY(calc(var(--_space-stack-xs) * -1));
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    /*
     * Only lay the panel out while it is open. A base \`display\` would override the UA's
     * \`[popover]:not(:popover-open) { display: none }\`, leaving the closed panel laid out
     * (just transparent) and intercepting clicks meant for the trigger. The
     * \`display ... allow-discrete\` transition above keeps the fade-out.
     */
    .panel:popover-open,
    .panel.open {
        display: grid;
        opacity: 1;
        transform: translateY(0);

        @starting-style {
            opacity: 0;
            transform: translateY(calc(var(--_space-stack-xs) * -1));
        }
    }

    .panel::backdrop {
        background: transparent;
    }

    .panel-header {
        display: flex;
        align-items: center;
        gap: var(--_space-inline-md);
    }

    .preview-copy {
        display: grid;
        gap: 0;
        min-inline-size: 0;
    }

    .panel-title {
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        font-weight: 600;
        color: var(--color-text-primary, #18181b);
    }

    .hex-field {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .field-label {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-secondary);
    }

    .hex-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: calc(var(--_target-size) - 4px);
        padding-inline: max(var(--_space-inline-md), 0.75rem);
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        box-shadow: var(--_shadow-control);
    }

    .hex-input:focus {
        outline: none;
    }

    .hex-input:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .hex-hint {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .channels {
        display: grid;
        gap: var(--_space-stack-sm);
    }

    .channel {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .channel-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--_space-inline-md);
    }

    .channel-value {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .channel-input {
        appearance: none;
        -webkit-appearance: none;
        inline-size: 100%;
        block-size: 1.125rem;
        margin: 0;
        border: 0;
        background: transparent;
    }

    .channel-input:focus {
        outline: none;
    }

    .channel-input::-webkit-slider-runnable-track {
        block-size: 0.625rem;
        border-radius: var(--_radius-round, 9999px);
        background: var(--_channel-track, var(--_surface-subtle));
    }

    .channel-input::-moz-range-track {
        block-size: 0.625rem;
        border-radius: var(--_radius-round, 9999px);
        background: var(--_channel-track, var(--_surface-subtle));
    }

    .channel-input::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        inline-size: 1rem;
        block-size: 1rem;
        margin-block-start: -0.1875rem;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-round, 9999px);
        background: var(--_surface-page);
        box-shadow: var(--_shadow-control);
    }

    .channel-input::-moz-range-thumb {
        inline-size: 1rem;
        block-size: 1rem;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-round, 9999px);
        background: var(--_surface-page);
        box-shadow: var(--_shadow-control);
    }

    .channel-input:focus-visible::-webkit-slider-thumb {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    .channel-input:focus-visible::-moz-range-thumb {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    .presets {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .preset-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-inline-md);
    }

    .preset-button {
        display: inline-grid;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        background: transparent;
        cursor: pointer;
        border-radius: var(--_radius-round, 9999px);
    }

    .preset-button[aria-pressed="true"] {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .preset-button:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }
`,Tf=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`<label class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</label>`)}
        <div class="${t=>t.controlShellClass}" part="control-shell">
            <button
                id="${t=>t.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${t=>t.effectiveDisabled}"
                aria-controls="${t=>t.panelId}"
                aria-describedby="${t=>t.describedBy||null}"
                aria-expanded="${t=>t.expandedText}"
                aria-haspopup="dialog"
                aria-invalid="${t=>t.ariaInvalidText}"
                aria-labelledby="${t=>t.labelledBy}"
                @click="${t=>t.toggleOpen()}"
            >
                <violet-color-swatch
                    class="swatch"
                    part="swatch"
                    decorative
                    size="${t=>t.swatchSize}"
                    value="${t=>t.currentSelectedColor}"
                ></violet-color-swatch>
                <span class="trigger-copy">
                    <span class="${t=>t.triggerValueClass}" id="${t=>t.valueId}">${t=>t.triggerValueText}</span>
                    <span class="trigger-meta" id="${t=>t.metaId}">${t=>t.triggerMetaText}</span>
                </span>
                <span class="trigger-icon" aria-hidden="true">
                    <violet-icon icon="system/chevron-right" decorative></violet-icon>
                </span>
            </button>
            <div
                id="${t=>t.panelId}"
                class="${t=>t.panelClass}"
                part="panel"
                popover="auto"
                role="dialog"
                aria-label="${t=>t.panelLabel}"
                @toggle="${(t,e)=>t.handleToggle(e.event)}"
            >
                <div class="panel-header" part="panel-header">
                    <violet-color-swatch value="${t=>t.currentSelectedColor}" size="comfortable" decorative></violet-color-swatch>
                    <div class="preview-copy">
                        <div class="panel-title">${t=>t.panelTitleText}</div>
                    </div>
                </div>
                <div class="hex-field">
                    <label class="field-label" for="${t=>t.hexInputId}">Hex value</label>
                    <input
                        id="${t=>t.hexInputId}"
                        class="hex-input"
                        part="hex-input"
                        type="text"
                        name="${t=>t.name}"
                        inputmode="text"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                        :value="${t=>t.value}"
                        ?disabled="${t=>t.effectiveDisabled}"
                        ?required="${t=>t.required}"
                        aria-invalid="${t=>t.invalid?"true":"false"}"
                        aria-describedby="${t=>t.hexHintId}"
                        @input="${(t,e)=>t.handleInput(e.event)}"
                        @change="${(t,e)=>t.handleCommit(e.event)}"
                        @blur="${(t,e)=>t.handleCommit(e.event)}"
                    />
                    <div class="hex-hint" id="${t=>t.hexHintId}">Use a 3- or 6-digit hex color.</div>
                </div>
                <div class="channels" part="channels">
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${t=>t.hueInputId}">Hue</label>
                            <span class="channel-value">${t=>Math.round(t.hue)}deg</span>
                        </div>
                        <input
                            id="${t=>t.hueInputId}"
                            class="channel-input"
                            style="--_channel-track: linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);"
                            type="range"
                            min="0"
                            max="360"
                            step="1"
                            :value="${t=>t.hue}"
                            @input="${(t,e)=>t.handleHueInput(e.event)}"
                            @change="${(t,e)=>t.handleHueCommit(e.event)}"
                        />
                    </div>
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${t=>t.saturationInputId}">Saturation</label>
                            <span class="channel-value">${t=>Math.round(t.saturation)}%</span>
                        </div>
                        <input
                            id="${t=>t.saturationInputId}"
                            class="channel-input"
                            style="${t=>t.saturationTrackStyle}"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="${t=>t.saturation}"
                            @input="${(t,e)=>t.handleSaturationInput(e.event)}"
                            @change="${(t,e)=>t.handleSaturationCommit(e.event)}"
                        />
                    </div>
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${t=>t.lightnessInputId}">Lightness</label>
                            <span class="channel-value">${t=>Math.round(t.lightness)}%</span>
                        </div>
                        <input
                            id="${t=>t.lightnessInputId}"
                            class="channel-input"
                            style="${t=>t.lightnessTrackStyle}"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="${t=>t.lightness}"
                            @input="${(t,e)=>t.handleLightnessInput(e.event)}"
                            @change="${(t,e)=>t.handleLightnessCommit(e.event)}"
                        />
                    </div>
                </div>
                <div class="presets" part="presets">
                    <div class="field-label">Suggested swatches</div>
                    <div class="preset-grid">
                        ${L(t=>t.presets,u`
                                <button
                                    class="preset-button"
                                    type="button"
                                    aria-label="${(t,e)=>e.parent.presetAriaLabel(t)}"
                                    aria-pressed="${(t,e)=>String(e.parent.currentDisplayColor===t)}"
                                    @click="${(t,e)=>e.parent.applyPreset(t)}"
                                >
                                    <violet-color-swatch decorative shape="circle" value="${t=>t}"></violet-color-swatch>
                                </button>
                            `)}
                    </div>
                </div>
                <slot name="presets"></slot>
            </div>
        </div>
        ${b(t=>!!t.supportingText&&!t.isInvalid,u`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${b(t=>!!(t.isInvalid&&t.errorText),u`<p class="error" part="error-text" id="${t=>t.errorId}">${t=>t.errorText}</p>`)}
    </div>
`,re=class extends f{static{this.formAssociated=!0}#e;#t;#i;#r;#n;constructor(){super(),this.#t="",this.#i="",this.#r=!1,this.#n=()=>{this.open&&this.positionPanel()},this.open=!1,this.hue=0,this.saturation=0,this.lightness=0,this.hexDraft="",this.validationInvalid=!1;let e=ic;ic+=1,this.#e=this.attachInternals(),this.labelId=`violet-color-picker-label-${e}`,this.triggerId=`violet-color-picker-trigger-${e}`,this.valueId=`violet-color-picker-value-${e}`,this.metaId=`violet-color-picker-meta-${e}`,this.panelId=`violet-color-picker-panel-${e}`,this.supportingId=`violet-color-picker-supporting-${e}`,this.errorId=`violet-color-picker-error-${e}`,this.hexInputId=`violet-color-picker-hex-${e}`,this.hexHintId=`violet-color-picker-hex-hint-${e}`,this.hueInputId=`violet-color-picker-hue-${e}`,this.saturationInputId=`violet-color-picker-saturation-${e}`,this.lightnessInputId=`violet-color-picker-lightness-${e}`,this.label="",this.value="",this.name="",this.supportingText="",this.errorText="",this.disabled=!1,this.required=!1,this.invalid=!1,this.size="natural",this.syncFromColor(this.value)}connectedCallback(){super.connectedCallback(),this.#i=this.value,this.#t=this.currentSelectedColor,this.syncFromColor(this.value),this.#s(),this.syncOpenState(),window.addEventListener("resize",this.#n),window.addEventListener("scroll",this.#n,!0)}disconnectedCallback(){window.removeEventListener("resize",this.#n),window.removeEventListener("scroll",this.#n,!0),super.disconnectedCallback()}valueChanged(){this.$fastController.isConnected&&(this.#r||(this.#t=this.currentSelectedColor),this.syncFromColor(this.value),this.#s())}disabledChanged(){this.effectiveDisabled&&this.open&&this.close(),this.$fastController.isConnected&&this.#s()}requiredChanged(){this.$fastController.isConnected&&this.#s()}invalidChanged(){this.$fastController.isConnected&&this.#s()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get presets(){return $f}get currentDisplayColor(){return nt(this.value)??Wt({h:this.hue,s:this.saturation,l:this.lightness})}get currentSelectedColor(){return nt(this.value)??""}get describedBy(){let e=[];return this.isInvalid&&this.errorText?e.push(this.errorId):this.supportingText&&e.push(this.supportingId),e.join(" ")}get labelledBy(){let e=[];return this.label&&e.push(this.labelId),e.push(this.valueId,this.metaId),e.join(" ")}get panelLabel(){return this.label?`${this.label} color picker`:"Color picker"}get panelTitleText(){return this.value?"Selected color":"No color selected"}get controlShellClass(){return`control-shell${this.open?" open":""}`}get panelClass(){return`panel${this.open?" open":""}`}get expandedText(){return String(this.open)}get ariaInvalidText(){return this.isInvalid?"true":"false"}get isInvalid(){return this.invalid||this.validationInvalid}get swatchSize(){return this.size}get triggerValueClass(){return this.value?"trigger-value":"trigger-value placeholder"}get triggerValueText(){return this.value||"Choose color"}get triggerMetaText(){return this.value?"Adjust color":"Select a color"}get saturationTrackStyle(){return`--_channel-track: ${ec(this.hue,this.lightness)};`}get lightnessTrackStyle(){return`--_channel-track: ${tc(this.hue,this.saturation)};`}toggleOpen(){if(this.effectiveDisabled)return;let e=this.panelElement;e&&(e.matches(":popover-open")?e.hidePopover():e.showPopover())}close(){this.panelElement?.matches(":popover-open")&&this.panelElement.hidePopover()}handleToggle(e){this.open=e.newState==="open",this.syncOpenState(),this.open?(this.positionPanel(),requestAnimationFrame(()=>{this.positionPanel(),this.hexInputElement?.focus(),this.hexInputElement?.select()})):(this.hexDraft=this.currentSelectedColor,this.syncHexInputValue())}handleHexInput(e){let i=e.currentTarget;this.hexDraft=i.value;let r=nt(i.value);!r||i.value.trim().replace(/^#/,"").length!==6||this.applyColor(r,!0,!1)}handleInput(e){this.handleHexInput(e)}handleHexCommit(e){let i=e.currentTarget,r=nt(i.value);if(!r){this.hexDraft=this.currentSelectedColor,this.syncHexInputValue();return}this.applyColor(r,!0,!0)}handleCommit(e){this.handleHexCommit(e)}handleChannelInput(e,i){let r=i.currentTarget,o=Number(r.value);this.updateChannel(e,o),this.commitFromChannels(!0,!1)}handleChannelCommit(e,i){let r=i.currentTarget,o=Number(r.value);this.updateChannel(e,o),this.commitFromChannels(!0,!0)}handleHueInput(e){this.handleChannelInput("h",e)}handleHueCommit(e){this.handleChannelCommit("h",e)}handleSaturationInput(e){this.handleChannelInput("s",e)}handleSaturationCommit(e){this.handleChannelCommit("s",e)}handleLightnessInput(e){this.handleChannelInput("l",e)}handleLightnessCommit(e){this.handleChannelCommit("l",e)}applyPreset(e){this.applyColor(e,!0,!0)}presetAriaLabel(e){return`Use ${e}`}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#i,this.syncFromColor(this.value),this.#s()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get panelElement(){return this.shadowRoot?.querySelector(".panel")??null}get controlShellElement(){return this.shadowRoot?.querySelector(".control-shell")??null}get hexInputElement(){return this.shadowRoot?.querySelector(".hex-input")??null}syncFromColor(e){let i=nt(e),r=Zl(i||Sf);r&&(this.hue=r.h,this.saturation=r.s,this.lightness=r.l,this.hexDraft=i??"",this.syncHexInputValue())}updateChannel(e,i){switch(e){case"h":this.hue=st(i,0,360);break;case"s":this.saturation=st(i,0,100);break;case"l":this.lightness=st(i,0,100);break}}commitFromChannels(e,i){let r=Wt({h:this.hue,s:this.saturation,l:this.lightness});this.applyColor(r,e,i)}applyColor(e,i,r){let o=nt(e);if(!o)return;let s=o!==this.currentSelectedColor;s&&(this.#r=!0,this.value=o,this.#r=!1),this.hexDraft=o,this.syncFromColor(o),this.#s(),i&&s&&this.$emit("input",{value:o}),r&&o!==this.#t&&(this.#t=o,this.$emit("change",{value:o}))}#s(){if(this.#e.setFormValue(this.value||null),this.effectiveDisabled){this.validationInvalid=!1,this.removeAttribute("data-invalid"),this.#e.setValidity({});return}if(this.invalid){this.validationInvalid=!0,this.setAttribute("data-invalid",""),this.#e.setValidity({customError:!0},this.errorText||"The selected color is invalid.");return}if(this.required&&!this.value){this.validationInvalid=!0,this.setAttribute("data-invalid",""),this.#e.setValidity({valueMissing:!0},this.errorText||"Select a color.");return}this.validationInvalid=!1,this.removeAttribute("data-invalid"),this.#e.setValidity({})}syncHexInputValue(){let e=this.hexInputElement;!e||e.value===this.hexDraft||(e.value=this.hexDraft)}syncOpenState(){this.controlShellElement?.classList.toggle("open",this.open),this.panelElement?.classList.toggle("open",this.open),this.panelElement&&(this.panelElement.style.opacity=this.open?"1":"0",this.panelElement.style.transform=this.open?"translateY(0)":"translateY(calc(var(--_space-stack-xs) * -1))")}positionPanel(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".trigger");if(!e||!i)return;let r=i.getBoundingClientRect(),o=8,s=6,n=r.left,a=r.bottom+s,l=Math.min(Math.max(r.width,320),window.innerWidth-o*2);e.style.width=`${l}px`,e.style.left=`${Math.max(o,n)}px`,e.style.top=`${Math.max(o,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-o&&(n=Math.max(o,window.innerWidth-d.width-o)),d.bottom>window.innerHeight-o&&(a=Math.max(o,r.top-d.height-s)),e.style.left=`${n}px`,e.style.top=`${a}px`})}};c(re.prototype,"label");c(re.prototype,"value");c(re.prototype,"name");c({attribute:"supporting-text"})(re.prototype,"supportingText");c({attribute:"error-text"})(re.prototype,"errorText");c({mode:"boolean"})(re.prototype,"disabled");q(re.prototype);c({mode:"boolean"})(re.prototype,"required");c({mode:"boolean"})(re.prototype,"invalid");c(re.prototype,"size");m(re.prototype,"open");m(re.prototype,"hue");m(re.prototype,"saturation");m(re.prototype,"lightness");m(re.prototype,"hexDraft");m(re.prototype,"validationInvalid");customElements.get("violet-color-picker")||await re.define({name:"violet-color-picker",template:Tf,styles:Ef});var rc=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},If=v`
    ${E}

    :host {
        display: block;
        --_approval-font-size: var(--violet-approval-font-size, var(--_body-size, 14px));
        --_approval-line-height: var(--violet-approval-line-height, var(--_body-line, 20px));
        --_approval-caption-size: var(--violet-approval-caption-size, var(--_caption-size, 12px));
        --_approval-border-color: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_warning-bg-subtle: var(--color-state-warning-background, #fdebcc);
        --_warning-text: var(--color-state-warning-text, #92400e);
        --_success-bg-subtle: var(--color-state-success-background, #e3f1e7);
        --_success-text: var(--color-state-success-text, #166534);
        --_danger-bg-subtle: var(--color-state-danger-background, #fbe2e2);
        --_danger-text: var(--color-state-danger-text, #b42318);
    }

    .frame {
        display: block;
        --violet-card-border-color: var(--_approval-border-color);
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    :host([state="approved"]) .frame {
        --violet-card-border-color: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
    }

    :host([state="denied"]) .frame {
        --violet-card-border-color: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        background: var(--_warning-bg-subtle);
        font-size: var(--_approval-caption-size);
        font-weight: 600;
        color: var(--_warning-text);
    }

    :host([state="approved"]) .header {
        background: var(--_success-bg-subtle);
        color: var(--_success-text);
    }

    :host([state="denied"]) .header {
        background: var(--_danger-bg-subtle);
        color: var(--_danger-text);
    }

    .header-leading {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
    }

    .header-icon {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_approval-line-height) + var(--_space-sm));
        block-size: calc(var(--_approval-line-height) + var(--_space-sm));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, currentColor 12%, transparent);
        --violet-icon-size: var(--_approval-line-height);
    }

    .header-title {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status-chip {
        flex-shrink: 0;
        margin-inline-start: auto;
        padding: 2px var(--_space-sm);
        border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, currentColor 10%, transparent);
        font-size: var(--_approval-caption-size);
        line-height: var(--_approval-line-height);
        color: inherit;
    }

    .summary {
        display: grid;
        gap: var(--_space-stack-2xs);
        font-size: var(--_approval-font-size);
        line-height: var(--_approval-line-height);
        color: var(--_text-primary, #1c1a0d);
    }

    .detail {
        display: grid;
        gap: var(--_space-stack-2xs);
        margin-block-start: var(--_space-sm);
        font-size: var(--_approval-caption-size);
        line-height: var(--_approval-line-height);
        color: var(--_text-secondary, #414651);
    }

    slot[name="summary"]::slotted(*),
    slot[name="detail"]::slotted(*) {
        margin: 0;
    }

    .detail[hidden] {
        display: none;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: 0;
    }

    .actions[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`,Af=u`
    <violet-card class="frame" part="root" appearance="outline" padding="medium" aria-label="Action requires approval">
        <div class="header" part="header" slot="header">
            <span class="header-leading">
                <span class="header-icon">
                    ${t=>t.state==="approved"?u`<violet-icon icon="system/checkmark" decorative></violet-icon>`:t.state==="denied"?u`<violet-icon icon="system/dismiss" decorative></violet-icon>`:u`<violet-icon icon="system/warning" decorative></violet-icon>`}
                </span>
                <span class="header-title">
                    ${t=>t.state==="approved"?"Approved":t.state==="denied"?"Denied":"Approval required"}
                </span>
            </span>
            <span class="status-chip" part="status-chip">
                ${t=>t.state==="approved"?"Confirmed":t.state==="denied"?"Blocked":"Pending"}
            </span>
        </div>
        <div class="summary" part="summary" ?hidden="${t=>!t.hasSummary}">
            <slot name="summary" @slotchange="${t=>t.handleSummarySlotChange()}"></slot>
        </div>
        <div class="detail" part="detail" ?hidden="${t=>!t.hasDetail}">
            <slot name="detail" @slotchange="${t=>t.handleDetailSlotChange()}"></slot>
        </div>
        <div class="actions" part="actions" slot="footer" ?hidden="${t=>t.state!=="pending"}">
            <slot name="actions">
                <violet-button
                    appearance="primary"
                    part="approve-button"
                    @click="${t=>t.handleApprove()}"
                >Approve</violet-button>
                <violet-button
                    appearance="secondary"
                    part="deny-button"
                    @click="${t=>t.handleDeny()}"
                >Deny</violet-button>
            </slot>
        </div>
    </violet-card>
`,Ri=class extends f{constructor(){super(),this.state="pending",this.hasSummary=!1,this.hasDetail=!1}connectedCallback(){super.connectedCallback(),gt(),Ae(),ii(),this.handleSummarySlotChange(),this.handleDetailSlotChange()}handleApprove(){this.$emit("approve")}handleDeny(){this.$emit("deny")}handleSummarySlotChange(){let e=this.shadowRoot?.querySelector('slot[name="summary"]');this.hasSummary=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleDetailSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="detail"]');this.hasDetail=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};rc([m],Ri.prototype,"hasSummary",void 0);rc([m],Ri.prototype,"hasDetail",void 0);c(Ri.prototype,"state");customElements.get("violet-approval-card")||await f.define(Ri,{name:"violet-approval-card",template:Af,styles:If});var Rf={fromView(t){let e=Number(t);return Number.isFinite(e)&&e>0?e:4},toView(t){return String(t)}},Ff={fromView(t){if(t==null||t==="")return null;let e=Number(t);return Number.isInteger(e)&&e>=0?e:null},toView(t){return t==null?null:String(t)}},Df=v`
    ${F}

    :host {
        display: grid;
        --_space-layout-sm: var(--space-layout-sm, 12px);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: flex-start;
        inline-size: 100%;
        min-block-size: calc(var(--_target-size) * 2 + var(--_space-layout-sm));
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_target-size) * 0.25);
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        font-family: inherit;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control {
        flex: 1 1 auto;
        min-inline-size: 0;
        min-block-size: calc(var(--_target-size) * 1.5);
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--color-text-primary, #18181b);
        box-shadow: none;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        resize: vertical;
    }

    .control::placeholder {
        color: var(--_text-muted);
    }

    .control:focus {
        outline: none;
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([readonly]) .control-frame {
        background: var(--_surface-subtle);
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([disabled]) .control,
    :host(:disabled) .control {
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    slot[name="before"] {
        display: inline-flex;
        align-items: flex-start;
        flex: 0 0 auto;
        color: var(--_text-muted);
        padding-block-start: calc((var(--_type-body-line) - 1em) / 2);
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    .supporting {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`,Mf=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>
            `)}
        <div class="control-frame" part="control-frame">
            <slot name="before" part="before"></slot>
            <textarea
                id="${t=>t.inputId}"
                class="control"
                part="control"
                name="${t=>t.name}"
                rows="${t=>t.rows}"
                placeholder="${t=>t.placeholder}"
                maxlength="${t=>t.maxLength??void 0}"
                aria-describedby="${t=>t.supportingText?t.supportingId:void 0}"
                :value="${t=>t.value}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?readonly="${t=>t.readonly}"
                ?required="${t=>t.required}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            ></textarea>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p id="${t=>t.supportingId}" class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
    </div>
`,oc=0,ye=class extends f{static{this.formAssociated=!0}#e;#t;constructor(){super(),this.#e=this.attachInternals(),oc+=1,this.inputId=`violet-text-area-${oc}`,this.supportingId=`${this.inputId}-supporting`,this.label="",this.placeholder="",this.value="",this.supportingText="",this.maxLength=null,this.rows=4,this.disabled=!1,this.readonly=!1,this.invalid=!1,this.name="",this.required=!1,this.#t=""}connectedCallback(){super.connectedCallback(),this.#t=this.getAttribute("value")??this.value,this.#i()}handleInput(e){let i=e.currentTarget;this.value=i?.value??"",this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}valueChanged(){this.#i()}disabledChanged(){this.#i()}invalidChanged(){this.#i()}readonlyChanged(){this.#i()}requiredChanged(){this.#i()}#i(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector("textarea");if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:this.value),this.effectiveDisabled||this.readonly){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},"Please correct this field.",e??void 0);return}if(this.required&&!this.value.trim()){this.#e.setValidity({valueMissing:!0},"Please fill out this field.",e??void 0);return}this.#e.setValidity({})}};c(ye.prototype,"label");c(ye.prototype,"placeholder");c({mode:"fromView"})(ye.prototype,"value");c({attribute:"supporting-text"})(ye.prototype,"supportingText");c({attribute:"maxlength",converter:Ff})(ye.prototype,"maxLength");c({converter:Rf})(ye.prototype,"rows");c({mode:"boolean"})(ye.prototype,"disabled");q(ye.prototype);c({mode:"boolean"})(ye.prototype,"readonly");c({mode:"boolean"})(ye.prototype,"invalid");c(ye.prototype,"name");c({mode:"boolean"})(ye.prototype,"required");customElements.get("violet-text-area")||await f.define(ye,{name:"violet-text-area",template:Mf,styles:Df,shadowOptions:{delegatesFocus:!0}});var sn=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Of=v`
    ${E}

    :host {
        display: block;
        --_composer-font-size: var(--violet-composer-font-size, var(--_body-size, 14px));
        --_composer-line-height: var(--violet-composer-line-height, var(--_body-line, 20px));
        --_composer-min-rows: var(--violet-composer-min-rows, 3);
        --_composer-max-rows: var(--violet-composer-max-rows, 8);
    }

    .root {
        display: flex;
        flex-direction: column;
        border: var(--_card-border-width, 1px) solid var(--_border-subtle);
        border-radius: var(--_radius-lg);
        background: var(--_surface-card);
        overflow: hidden;
        transition: border-color 0.15s ease;
    }

    .root:focus-within {
        border-color: var(--_focus-ring);
    }

    .input-row {
        display: flex;
        align-items: flex-end;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
    }

    .input-field {
        flex: 1;
        min-inline-size: 0;
        --_surface-page: transparent;
        --_surface-subtle: transparent;
        --_border-subtle: transparent;
        --_shadow-control: none;
        --_focus-ring: transparent;
    }

    .input-field::part(control-frame) {
        min-block-size: auto;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        transform: none;
    }

    .input-field::part(label) {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    .input-field::part(control) {
        min-block-size: calc(var(--_composer-line-height) * var(--_composer-min-rows));
        max-block-size: calc(var(--_composer-line-height) * var(--_composer-max-rows));
        padding-block: var(--_space-xs, 4px);
        resize: none;
        overflow-y: auto;
        field-sizing: content;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: 0 var(--_space-md) var(--_space-sm);
    }

    .actions[hidden] {
        display: none;
    }

    .footer {
        padding: var(--_space-xs, 4px) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid var(--_border-subtle);
        font-size: calc(var(--_composer-font-size) * 0.85);
        color: var(--_text-secondary, #414651);
    }

    .footer[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`,Lf=u`
    <div class="root" part="root">
        <div class="input-row">
            <violet-text-area
                class="input-field"
                part="input"
                label="${t=>t.label}"
                placeholder="${t=>t.placeholder}"
                value="${t=>t.value}"
                ?disabled="${t=>t.disabled||t.status==="submitted"||t.status==="streaming"}"
                rows="3"
                @keydown="${(t,e)=>t.handleKeydown(e.event)}"
                @input="${(t,e)=>t.handleInput(e.event)}"
            ></violet-text-area>
            ${t=>t.status==="streaming"?u`
                    <violet-icon-button
                        appearance="primary"
                        label="Stop generating"
                        part="stop-button"
                        @click="${e=>e.handleStop()}"
                    >
                        <violet-icon icon="system/stop" decorative></violet-icon>
                    </violet-icon-button>
                `:u`
                    <violet-icon-button
                        appearance="primary"
                        label="Send message"
                        part="submit-button"
                        ?disabled="${e=>!e.canSubmit}"
                        @click="${e=>e.handleSubmit()}"
                    >
                        <violet-icon icon="system/arrow-up" decorative></violet-icon>
                    </violet-icon-button>
                `}
        </div>
        <div class="actions" part="actions" ?hidden="${t=>!t.hasActions}">
            <slot name="actions" @slotchange="${t=>t.handleActionsSlotChange()}"></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter}">
            <slot name="footer" @slotchange="${t=>t.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`,Ue=class extends f{constructor(){super(),this.status="ready",this.placeholder="Send a message\u2026",this.label="Message",this.disabled=!1,this.value="",this.hasInput=!1,this.hasActions=!1,this.hasFooter=!1}connectedCallback(){super.connectedCallback(),Cs(),Is(),this.syncInputState(),queueMicrotask(()=>this.syncTextareaHeight())}get textAreaField(){return this.shadowRoot?.querySelector("violet-text-area")}get textareaEl(){return this.textAreaField?.shadowRoot?.querySelector("textarea")}get canSubmit(){return!this.disabled&&this.status!=="submitted"&&this.status!=="streaming"&&!!this.value.trim()}handleKeydown(e){return e.isComposing||e.keyCode===229?!0:e.key==="Enter"&&!e.shiftKey?(e.preventDefault(),this.status!=="streaming"&&this.handleSubmit(),!1):!0}handleInput(e){let i=this.textAreaField;this.value=i?.value??"",this.hasInput=!!this.value.trim(),this.syncTextareaHeight()}handleSubmit(){let e=this.textAreaField,i=e?.value.trim();!i||this.disabled||this.status==="submitted"||this.status==="streaming"||(this.$emit("submit",{text:i}),e&&(e.value=""),this.value="",this.hasInput=!1,this.syncTextareaHeight())}handleStop(){this.$emit("stop")}handleActionsSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="actions"]');this.hasActions=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}valueChanged(){this.$fastController.isConnected&&(this.syncInputState(),queueMicrotask(()=>this.syncTextareaHeight()))}syncInputState(){this.hasInput=!!this.value.trim()}syncTextareaHeight(){let e=this.textareaEl;if(!e)return;let i=Number.parseFloat(getComputedStyle(e).lineHeight)||20,r=Number.parseFloat(getComputedStyle(this).getPropertyValue("--_composer-max-rows"))||8,o=i*r;e.style.height="auto",e.style.height=`${Math.min(e.scrollHeight,o)}px`,e.style.overflowY=e.scrollHeight>o?"auto":"hidden"}};sn([m],Ue.prototype,"hasInput",void 0);sn([m],Ue.prototype,"hasActions",void 0);sn([m],Ue.prototype,"hasFooter",void 0);c(Ue.prototype,"status");c(Ue.prototype,"placeholder");c(Ue.prototype,"label");c({mode:"fromView"})(Ue.prototype,"value");c({mode:"boolean"})(Ue.prototype,"disabled");customElements.get("violet-chat-composer")||await f.define(Ue,{name:"violet-chat-composer",template:Lf,styles:Of,shadowOptions:{delegatesFocus:!0}});var Vf=v`
    ${E}

    :host {
        display: block;
        --_suggestion-font-size: var(--violet-suggestion-font-size, var(--_caption-size, 12px));
        --_suggestion-line-height: var(--violet-suggestion-line-height, var(--_caption-line, 16px));
    }

    .root {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-sm);
    }

    :host([orientation="vertical"]) .root {
        flex-direction: column;
        flex-wrap: nowrap;
    }

    ::slotted(*) {
        all: unset;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        padding: var(--_space-sm) var(--_space-md);
        border: var(--_card-border-width, 1px) solid var(--_border-subtle);
        border-radius: var(--_radius-round, 9999px);
        font-size: var(--_suggestion-font-size);
        line-height: var(--_suggestion-line-height);
        color: var(--_text-primary, #1c1a0d);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
        white-space: nowrap;
    }

    ::slotted(*:hover) {
        background: var(--_surface-hover, rgba(28, 26, 13, 0.06));
        border-color: var(--_text-secondary, #414651);
    }

    ::slotted(*:focus-visible) {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    @media (forced-colors: active) {
        ::slotted(*) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
        }

        ::slotted(*:hover) {
            background: Highlight;
            color: HighlightText;
        }
    }
`,Pf=u`
    <div class="root" part="root" role="group" aria-label="Suggested prompts">
        <slot @slotchange="${t=>t.ensureChipRoles()}" @click="${(t,e)=>t.handleClick(e.event)}" @keydown="${(t,e)=>t.handleKeydown(e.event)}"></slot>
    </div>
`,Co=class extends f{constructor(){super(),this.orientation="horizontal"}connectedCallback(){super.connectedCallback(),this.ensureChipRoles()}chipOf(e){let i=e;for(;i&&i.parentNode!==this;)i=i.parentNode;return i instanceof HTMLElement?i:null}handleClick(e){let i=this.chipOf(e.target);if(i){let r=i.textContent?.trim()??"";r&&this.$emit("select",{text:r})}}handleKeydown(e){let i=this.chipOf(e.target)??e.target;if((e.key==="Enter"||e.key===" ")&&this.chipOf(e.target)){e.preventDefault();let r=i.textContent?.trim()??"";return r&&this.$emit("select",{text:r}),!1}return e.key==="ArrowRight"||e.key==="ArrowDown"?(e.preventDefault(),this.focusNextChip(i,1),!1):e.key==="ArrowLeft"||e.key==="ArrowUp"?(e.preventDefault(),this.focusNextChip(i,-1),!1):!0}ensureChipRoles(){for(let e of Array.from(this.children))e.getAttribute("role")||e.setAttribute("role","button"),e.hasAttribute("tabindex")||e.setAttribute("tabindex","0")}focusNextChip(e,i){let r=Array.from(this.children),o=r.indexOf(e);if(o===-1)return;let s=r[o+i];s&&s.focus()}};c(Co.prototype,"orientation");customElements.get("violet-chat-suggestions")||await f.define(Co,{name:"violet-chat-suggestions",template:Pf,styles:Vf});var sc=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Bf=v`
    ${E}

    :host {
        display: flex;
        flex-direction: column;
        min-block-size: 0;
        position: relative;
        overflow: hidden;
    }

    .scroll-region {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        scroll-behavior: smooth;
        overscroll-behavior-y: contain;
    }

    .scroll-region:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .content {
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        padding: var(--_space-sm);
    }

    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        padding: var(--_space-lg);
        color: var(--_text-secondary, #414651);
        text-align: center;
    }

    .empty[hidden] {
        display: none;
    }

    .scroll-anchor {
        block-size: 0;
        overflow: hidden;
    }
`,Nf=u`
    <div class="empty" part="empty" ?hidden="${t=>!t.empty}">
        <slot name="empty"></slot>
    </div>
    <div
        class="scroll-region"
        part="scroll-region"
        role="log"
        aria-live="${t=>t.busy?"off":"polite"}"
        aria-busy="${t=>t.busy?"true":"false"}"
        tabindex="0"
        ?hidden="${t=>t.empty}"
        @scroll="${(t,e)=>t.handleScroll(e.event)}"
        @wheel="${t=>t.cancelAutoScroll()}"
        @touchstart="${t=>t.cancelAutoScroll()}"
        @pointerdown="${t=>t.cancelAutoScroll()}"
        @keydown="${t=>t.cancelAutoScroll()}"
    >
        <div class="content" part="content">
            <slot></slot>
        </div>
        <div class="scroll-anchor" id="scroll-anchor"></div>
    </div>
`,ai=class extends f{constructor(){super(),this.busy=!1,this.empty=!1,this.isOverflowing=!1,this.userScrolledAway=!1}get#e(){return this.shadowRoot?.querySelector(".scroll-region")??null}connectedCallback(){super.connectedCallback(),this.#n(),this.#s(),this.#o()}scrollToBottom(){let e=this.#e;e&&(e.scrollTop=e.scrollHeight,this.userScrolledAway=!1,this.#t=e.scrollHeight-e.scrollTop-e.clientHeight>1)}cancelAutoScroll(){return this.#t=!1,!0}#t=!1;handleScroll(e){let i=this.#e;if(!i)return;let r=i.scrollHeight-i.scrollTop-i.clientHeight;if(this.#t){r<=1&&(this.#t=!1);return}this.userScrolledAway=r>50}#i=null;#r=null;#n(){this.#i=new MutationObserver(()=>{this.#o(),this.userScrolledAway||requestAnimationFrame(()=>this.scrollToBottom())});let e=this.shadowRoot?.querySelector("slot:not([name])");e&&e.addEventListener("slotchange",()=>{this.#o(),this.userScrolledAway||requestAnimationFrame(()=>this.scrollToBottom())}),this.#i.observe(this,{childList:!0,subtree:!0,characterData:!0})}#s(){let e=this.#e;!e||typeof ResizeObserver>"u"||(this.#r=new ResizeObserver(()=>{this.#o()}),this.#r.observe(e))}#o(){requestAnimationFrame(()=>this.#a())}#a(){let e=this.#e;if(!e||this.empty){this.isOverflowing=!1;return}this.isOverflowing=e.scrollHeight-e.clientHeight>1}disconnectedCallback(){super.disconnectedCallback(),this.#i?.disconnect(),this.#i=null,this.#r?.disconnect(),this.#r=null}};sc([m],ai.prototype,"isOverflowing",void 0);sc([m],ai.prototype,"userScrolledAway",void 0);c({mode:"boolean"})(ai.prototype,"busy");c({mode:"boolean"})(ai.prototype,"empty");customElements.get("violet-conversation-thread")||await f.define(ai,{name:"violet-conversation-thread",template:Nf,styles:Bf});var nc=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},jf=v`
    ${E}

    :host {
        display: block;
        --_msg-border-width: var(--_card-border-width, 1px);
        --_msg-body-size: var(--violet-message-body-size, var(--_body-size, 14px));
        --_msg-body-line: var(--violet-message-body-line, var(--_body-line, 20px));
        --_msg-system-size: var(--violet-message-system-size, var(--_caption-size, 12px));
        --_msg-meta-size: var(--violet-message-meta-size, var(--_meta-size, 11px));
    }

    .root {
        display: flex;
        gap: var(--_space-sm);
        align-items: flex-start;
    }

    :host([message-role="user"]) .root {
        flex-direction: row-reverse;
    }

    .avatar {
        flex-shrink: 0;
    }

    .avatar[hidden] {
        display: none;
    }

    .surface {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        max-inline-size: 85%;
        min-inline-size: 0;
        padding: var(--_space-sm) var(--_space-md);
        border-radius: var(--_radius-lg);
        font-size: var(--_msg-body-size);
        line-height: var(--_msg-body-line);
    }

    :host([message-role="assistant"]) .surface {
        background: var(--_surface-card);
        border: var(--_msg-border-width) solid var(--_border-subtle);
    }

    :host([message-role="user"]) .surface {
        background: var(--_surface-subtle);
        border: var(--_msg-border-width) solid transparent;
    }

    :host([message-role="system"]) .surface {
        background: transparent;
        border: var(--_msg-border-width) solid var(--_border-subtle);
        max-inline-size: 100%;
        text-align: center;
        font-size: var(--_msg-system-size);
        color: var(--_text-secondary, #414651);
    }

    :host([tone="error"]) .surface {
        border-color: var(--_danger-border, rgba(220, 38, 38, 0.34));
    }

    :host([tone="success"]) .surface {
        border-color: var(--_success-border, rgba(22, 163, 74, 0.34));
    }

    :host([tone="muted"]) .surface {
        opacity: 0.7;
    }

    .meta {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        font-size: var(--_msg-meta-size);
        color: var(--_text-secondary, #414651);
    }

    .meta[hidden] {
        display: none;
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        min-inline-size: 0;
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            border: var(--_msg-border-width) solid ButtonText;
            background: Canvas;
        }
    }
`,Hf=u`
    <article
        class="root"
        part="root"
        aria-label="${t=>`${t.messageRole} message`}"
        aria-busy="${t=>t.streaming?"true":null}"
    >
        <div class="avatar" part="avatar" ?hidden="${t=>!t.hasAvatar}">
            <slot name="avatar" @slotchange="${t=>t.handleAvatarSlotChange()}"></slot>
        </div>
        <div class="surface" part="surface">
            <div class="meta" part="meta" ?hidden="${t=>!t.hasMeta}">
                <slot name="meta" @slotchange="${t=>t.handleMetaSlotChange()}"></slot>
            </div>
            <div class="body" part="body">
                <slot></slot>
            </div>
        </div>
    </article>
`,Kt=class extends f{constructor(){super(),this.hasAvatar=!1,this.hasMeta=!1,this.messageRole="assistant",this.tone="default",this.streaming=!1}handleAvatarSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="avatar"]');this.hasAvatar=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleMetaSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="meta"]');this.hasMeta=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};nc([m],Kt.prototype,"hasAvatar",void 0);nc([m],Kt.prototype,"hasMeta",void 0);c({attribute:"message-role"})(Kt.prototype,"messageRole");c(Kt.prototype,"tone");c({mode:"boolean"})(Kt.prototype,"streaming");customElements.get("violet-message")||await f.define(Kt,{name:"violet-message",template:Hf,styles:jf});var qf=v`
    ${E}

    :host {
        display: block;
        --_cursor-width: var(--violet-cursor-width, 0.125em);
        --_cursor-height: var(--violet-cursor-height, 1em);
        --_cursor-gap: var(--violet-cursor-gap, 0.125em);
    }

    .text {
        display: grid;
        align-content: start;
        gap: var(--_space-stack-xs);
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        line-height: inherit;
    }

    .content-slot {
        display: block;
    }

    .content-slot::slotted(*) {
        margin: 0;
    }

    .cursor {
        display: inline-block;
        inline-size: var(--_cursor-width);
        block-size: var(--_cursor-height);
        background: currentColor;
        vertical-align: text-bottom;
        margin-inline-start: var(--_cursor-gap);
        animation: blink 0.8s step-end infinite;
    }

    .cursor[hidden] {
        display: none;
    }

    @keyframes blink {
        50% { opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .cursor {
            animation: none;
        }
    }
`,Wf=u`
    <div class="text" part="text">
        <slot class="content-slot"></slot><span class="cursor" part="cursor" ?hidden="${t=>t.state!=="streaming"}" aria-hidden="true"></span>
    </div>
`,zo=class extends f{constructor(){super(),this.state="done"}};c(zo.prototype,"state");customElements.get("violet-message-text")||await f.define(zo,{name:"violet-message-text",template:Wf,styles:qf});var Uf=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Kf=v`
    ${E}

    :host {
        display: block;
        --_media-max-width: var(--violet-media-max-width, 100%);
        --_media-max-height: var(--violet-media-max-height, 300px);
        --_media-font-size: var(--violet-media-font-size, var(--_caption-size, 12px));
        --_media-line-height: var(--violet-media-line-height, var(--_caption-line, 16px));
    }

    .root {
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        max-inline-size: var(--_media-max-width);
    }

    .preview {
        border-radius: var(--_radius-md);
        overflow: hidden;
    }

    .preview img {
        display: block;
        max-inline-size: 100%;
        max-block-size: var(--_media-max-height);
        object-fit: contain;
        border-radius: var(--_radius-md);
    }

    .preview audio {
        display: block;
        inline-size: 100%;
    }

    .preview video {
        display: block;
        max-inline-size: 100%;
        max-block-size: var(--_media-max-height);
        border-radius: var(--_radius-md);
    }

    .file-row {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        border: var(--_card-border-width, 1px) solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-card);
    }

    .file-icon {
        flex-shrink: 0;
        --violet-icon-size: var(--_media-line-height);
    }

    .file-info {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
    }

    .file-name {
        font-size: var(--_media-font-size);
        line-height: var(--_media-line-height);
        color: var(--_text-primary, #1c1a0d);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-type {
        font-size: calc(var(--_media-font-size) * 0.85);
        color: var(--_text-secondary, #414651);
    }

    @media (forced-colors: active) {
        .file-row {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`,Gf=u`
    <div class="root" part="root">
        ${t=>t.renderMedia()}
    </div>
`,Ct=class extends f{constructor(){super(),this.failedSrc="",this.src="",this.mediaType="",this.filename="",this.alt="",this.allowedOrigins=""}connectedCallback(){super.connectedCallback(),fr()}isSourceAllowed(){let e=this.allowedOrigins.trim();if(!e)return!0;let i;try{i=new URL(this.src,document.baseURI)}catch{return!1}return i.protocol==="data:"||i.protocol==="blob:"||i.origin===location.origin?!0:i.protocol!=="http:"&&i.protocol!=="https:"?!1:e.split(/\s+/).some(r=>{try{return new URL(r).origin===i.origin}catch{return!1}})}handleImageError(){this.failedSrc=this.src}renderMedia(){if(!this.src)return u``;if(!this.isSourceAllowed()||this.failedSrc===this.src)return this.renderFileRow();let e=this.mediaType.split("/")[0].toLowerCase();return e==="image"?u`
                <div class="preview" part="preview">
                    <img src="${i=>i.src}" alt="${i=>i.alt||i.filename||"Image"}" loading="lazy" referrerpolicy="no-referrer" @error="${i=>i.handleImageError()}" />
                </div>
            `:e==="audio"?u`
                <div class="preview" part="preview">
                    <audio controls preload="metadata">
                        <source src="${i=>i.src}" type="${i=>i.mediaType}" />
                    </audio>
                </div>
            `:e==="video"?u`
                <div class="preview" part="preview">
                    <video controls preload="metadata">
                        <source src="${i=>i.src}" type="${i=>i.mediaType}" />
                    </video>
                </div>
            `:this.renderFileRow()}renderFileRow(){return u`
            <div class="file-row">
                <span class="file-icon" part="icon"><violet-icon icon="system/attach" decorative></violet-icon></span>
                <div class="file-info">
                    <span class="file-name" part="filename">${e=>e.filename||"File"}</span>
                    <span class="file-type">${e=>e.mediaType||"Unknown type"}</span>
                </div>
            </div>
        `}};Uf([m],Ct.prototype,"failedSrc",void 0);c(Ct.prototype,"src");c({attribute:"media-type"})(Ct.prototype,"mediaType");c(Ct.prototype,"filename");c(Ct.prototype,"alt");c({attribute:"allowed-origins"})(Ct.prototype,"allowedOrigins");customElements.get("violet-message-media")||await f.define(Ct,{name:"violet-message-media",template:Gf,styles:Kf});var Yf=v`
    ${E}

    :host {
        display: block;
        --_status-font-size: var(--violet-status-font-size, var(--_caption-size, 12px));
        --_status-line-height: var(--violet-status-line-height, var(--_caption-line, 16px));
        --_status-indicator-size: var(--violet-status-indicator-size, var(--_caption-line, 16px));
        --_status-dot-size: calc(var(--_status-indicator-size) * 0.375);
        --_status-streaming-dot-size: calc(var(--_status-indicator-size) * 0.25);
        --_status-streaming-gap: calc(var(--_status-streaming-dot-size) * 0.75);
    }

    .root {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) 0;
        font-size: var(--_status-font-size);
        line-height: var(--_status-line-height);
        color: var(--_text-secondary, #414651);
    }

    .indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        inline-size: var(--_status-indicator-size);
        block-size: var(--_status-indicator-size);
    }

    .dot {
        inline-size: var(--_status-dot-size);
        block-size: var(--_status-dot-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
    }

    :host([status="submitted"]) .dot {
        animation: pulse 1.4s ease-in-out infinite;
    }

    :host([status="streaming"]) .indicator,
    :host([status="retrying"]) .indicator {
        display: inline-flex;
        gap: var(--_status-streaming-gap);
    }

    .streaming-dot {
        inline-size: var(--_status-streaming-dot-size);
        block-size: var(--_status-streaming-dot-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
        animation: bounce 1.2s ease-in-out infinite;
    }

    .streaming-dot:nth-child(2) {
        animation-delay: 0.15s;
    }

    .streaming-dot:nth-child(3) {
        animation-delay: 0.3s;
    }

    :host([status="error"]) .root {
        color: var(--_danger-text, #dc2626);
    }

    :host([status="error"]) .dot {
        background: var(--_danger-text, #dc2626);
    }


    .text {
        min-inline-size: 0;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    @keyframes bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-4px); }
    }


    @media (prefers-reduced-motion: reduce) {
        :host([status="submitted"]) .dot,
        .streaming-dot {
            animation: none;
        }
    }

    @media (forced-colors: active) {
        .root {
            color: ButtonText;
        }

        :host([status="error"]) .root {
            color: LinkText;
        }
    }
`,Xf=u`
    <div class="root" part="root" role="status" aria-live="polite">
        <span class="indicator" part="indicator">
            ${t=>t.status==="streaming"||t.status==="retrying"?u`
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                    `:u`<span class="dot" aria-hidden="true"></span>`}
        </span>
        <span class="text" part="text">
            <slot>${t=>t.defaultText()}</slot>
        </span>
    </div>
`,So=class extends f{constructor(){super(),this.status="streaming"}defaultText(){switch(this.status){case"submitted":return"Thinking\u2026";case"streaming":return"Responding\u2026";case"error":return"Something went wrong";case"cancelled":return"Stopped";case"retrying":return"Retrying\u2026";default:return""}}};c(So.prototype,"status");customElements.get("violet-message-status")||await f.define(So,{name:"violet-message-status",template:Xf,styles:Yf});var Qf=v`
    ${E}

    :host {
        display: block;
        --_reasoning-bg: var(--violet-reasoning-bg, var(--_surface-subtle, rgba(28, 26, 13, 0.04)));
        --_reasoning-border: var(--violet-reasoning-border, var(--_border-subtle));
        --_reasoning-font-size: var(--violet-reasoning-font-size, var(--_caption-size, 12px));
        --_reasoning-line-height: var(--violet-reasoning-line-height, var(--_caption-line, 16px));
        --_reasoning-toggle-size: var(--violet-reasoning-toggle-size, var(--_body-size, 14px));
    }

    .root {
        border-radius: var(--_radius-md);
        border: var(--_card-border-width, 1px) solid var(--_reasoning-border);
        background: var(--_reasoning-bg);
        overflow: hidden;
    }

    .toggle {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        inline-size: 100%;
        padding: var(--_space-sm) var(--_space-md);
        font-size: var(--_reasoning-toggle-size);
        color: var(--_text-secondary, #414651);
        cursor: pointer;
    }

    .toggle:hover {
        background: var(--_surface-hover, rgba(28, 26, 13, 0.06));
    }

    .toggle:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .chevron {
        display: inline-flex;
        transition: transform 0.2s ease;
        --violet-icon-size: var(--_reasoning-toggle-size);
    }

    :host([expanded]) .chevron {
        transform: rotate(90deg);
    }

    .streaming-indicator {
        display: none;
        inline-size: var(--_reasoning-font-size);
        block-size: var(--_reasoning-font-size);
        border-radius: var(--_radius-round, 9999px);
        background: currentColor;
        animation: pulse 1.4s ease-in-out infinite;
    }

    :host([state="streaming"]) .streaming-indicator {
        display: inline-block;
    }

    .content {
        padding: 0 var(--_space-md) var(--_space-sm);
        font-size: var(--_reasoning-font-size);
        line-height: var(--_reasoning-line-height);
        color: var(--_text-secondary, #414651);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .content[hidden] {
        display: none;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    @media (prefers-reduced-motion: reduce) {
        .streaming-indicator {
            animation: none;
        }

        .chevron {
            transition: none;
        }
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .toggle:hover {
            background: Highlight;
            color: HighlightText;
        }
    }
`,Jf=u`
    <div class="root" part="root">
        <button
            class="toggle"
            part="toggle"
            type="button"
            aria-expanded="${t=>String(t.expanded)}"
            aria-controls="reasoning-content"
            @click="${t=>t.toggleExpanded()}"
        >
            <span class="chevron"><violet-icon icon="system/chevron-right" decorative></violet-icon></span>
            ${t=>t.label}
            <span class="streaming-indicator" aria-hidden="true"></span>
        </button>
        <div
            class="content"
            part="content"
            id="reasoning-content"
            role="region"
            ?hidden="${t=>!t.expanded}"
        >
            <slot></slot>
        </div>
    </div>
`,Fi=class extends f{constructor(){super(),this.expanded=!1,this.state="done",this.label="Thinking"}connectedCallback(){super.connectedCallback(),Be()}toggleExpanded(){this.expanded=!this.expanded}};c({mode:"boolean"})(Fi.prototype,"expanded");c(Fi.prototype,"state");c(Fi.prototype,"label");customElements.get("violet-reasoning-block")||await f.define(Fi,{name:"violet-reasoning-block",template:Jf,styles:Qf});var Zf=v`
    ${E}

    :host {
        display: inline-flex;
        --_citation-font-size: var(--violet-citation-font-size, var(--_caption-size, 12px));
        --_citation-line-height: var(--violet-citation-line-height, var(--_caption-line, 16px));
        --_citation-badge-size: var(--violet-citation-badge-size, var(--_caption-line, 16px));
        --_citation-max-width: var(--violet-citation-max-width, 200px);
        --_hc-border: var(--violet-hc-border, 1px solid ButtonText);
    }

    .root {
        display: inline-flex;
        align-items: center;
        gap: var(--_space-xs, 4px);
        font-size: var(--_citation-font-size);
        line-height: var(--_citation-line-height);
    }

    .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: var(--_citation-badge-size);
        block-size: var(--_citation-badge-size);
        padding-inline: var(--_space-xs, 4px);
        border-radius: var(--_radius-sm);
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        font-size: calc(var(--_citation-font-size) * 0.85);
        font-weight: 600;
        color: var(--_text-secondary, #414651);
    }

    .badge[hidden] {
        display: none;
    }

    .link {
        color: var(--_text-link, #2563eb);
        text-decoration: none;
        max-inline-size: var(--_citation-max-width);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .link:hover {
        text-decoration: underline;
    }

    .link:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
        border-radius: var(--_radius-sm);
    }

    .title {
        color: var(--_text-primary, #1c1a0d);
        max-inline-size: var(--_citation-max-width);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .doc-icon {
        display: inline-flex;
        color: var(--_text-secondary, #414651);
        --violet-icon-size: var(--_citation-line-height);
    }

    @media (forced-colors: active) {
        .link {
            color: LinkText;
        }

        .badge {
            forced-color-adjust: none;
            border: var(--_hc-border);
            background: Canvas;
        }
    }
`,em=u`
    <span class="root" part="root">
        <span class="badge" part="badge" ?hidden="${t=>!t.index}" aria-hidden="true">${t=>t.index}</span>
        ${t=>t.type==="url"&&t.href?ko(t.href)?u`
                    <a class="link" part="link" href="${e=>e.href}" target="_blank" rel="noopener noreferrer">
                        ${e=>e.sourceTitle||e.href}
                    </a>
                `:u`
                        <span class="title" part="title">${e=>e.sourceTitle||e.href}</span>
                    `:u`
                <span class="doc-icon" part="icon"><violet-icon icon="system/document" decorative></violet-icon></span>
                <span class="title" part="title">${e=>e.sourceTitle||"Document"}</span>
            `}
        <slot></slot>
    </span>
`,zt=class extends f{constructor(){super(),this.type="url",this.href="",this.sourceTitle="",this.sourceId="",this.mediaType="",this.index=""}connectedCallback(){super.connectedCallback(),vt()}};c(zt.prototype,"type");c(zt.prototype,"href");c({attribute:"source-title"})(zt.prototype,"sourceTitle");c({attribute:"source-id"})(zt.prototype,"sourceId");c({attribute:"media-type"})(zt.prototype,"mediaType");c(zt.prototype,"index");customElements.get("violet-source-citation")||await f.define(zt,{name:"violet-source-citation",template:em,styles:Zf});var ac=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},tm=v`
    ${E}

    :host {
        display: block;
        --_tool-font-size: var(--violet-tool-font-size, var(--_caption-size, 12px));
        --_tool-line-height: var(--violet-tool-line-height, var(--_caption-line, 16px));
        --_tool-name-size: var(--violet-tool-name-size, var(--_body-size, 14px));
        --_warning-bg: var(--color-state-warning-background, #fdebcc);
        --_warning-text: var(--color-state-warning-text, #92400e);
        --_warning-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_success-bg: var(--color-state-success-background, #e3f1e7);
        --_success-text: var(--color-state-success-text, #166534);
        --_success-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_danger-bg: var(--color-state-danger-background, #fbe2e2);
        --_danger-text-local: var(--color-state-danger-text, #b42318);
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .frame {
        display: block;
        --violet-card-border-color: var(--_border-subtle);
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    :host([state="approval-requested"]) .frame {
        --violet-card-border-color: var(--_warning-border);
    }

    :host([state="output-available"]) .frame {
        --violet-card-border-color: var(--_success-border);
    }

    :host([state="output-error"]) .frame {
        --violet-card-border-color: var(--_danger-border);
    }

    .approval-frame {
        display: block;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        border-block-end: var(--_card-border-width, 1px) solid var(--_border-subtle);
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
    }

    .icon {
        flex-shrink: 0;
        display: inline-flex;
        --violet-icon-size: var(--_tool-name-size);
    }

    .name {
        font-size: var(--_tool-name-size);
        font-weight: 600;
        color: var(--_text-primary, #1c1a0d);
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .badge {
        flex-shrink: 0;
        margin-inline-start: auto;
        padding: var(--_space-xs, 4px) var(--_space-sm);
        border-radius: var(--_radius-sm);
        font-size: var(--_tool-font-size);
        font-weight: 600;
        line-height: var(--_tool-line-height);
    }

    :host([state="pending"]) .badge,
    :host([state="executing"]) .badge {
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        color: var(--_text-secondary, #414651);
    }

    :host([state="approval-requested"]) .badge {
        background: var(--_warning-bg);
        color: var(--_warning-text);
    }

    :host([state="output-available"]) .badge {
        background: var(--_success-bg);
        color: var(--_success-text);
    }

    :host([state="output-error"]) .badge {
        background: var(--_danger-bg);
        color: var(--_danger-text-local);
    }

    :host([state="cancelled"]) .badge {
        background: var(--_surface-subtle, rgba(28, 26, 13, 0.04));
        color: var(--_text-secondary, #414651);
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        padding: var(--_space-sm) var(--_space-md);
        font-size: var(--_tool-font-size);
        line-height: var(--_tool-line-height);
        color: var(--_text-secondary, #414651);
    }

    .body:empty,
    .body[hidden] {
        display: none;
    }

    slot[name="summary"]::slotted(*),
    slot[name="input"]::slotted(*),
    slot[name="output"]::slotted(*),
    .body slot::slotted(*) {
        margin: 0;
    }

    .approval-summary {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .approval-tool-name {
        font-size: var(--_tool-name-size);
        font-weight: 600;
        line-height: var(--_body-line);
        color: var(--_text-primary);
    }

    .approval-detail {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .shimmer {
        display: flex;
        flex-direction: column;
        gap: var(--_space-xs, 4px);
    }

    .shimmer-line {
        block-size: var(--_tool-line-height);
        border-radius: var(--_radius-sm);
        background: linear-gradient(90deg,
            var(--_surface-subtle, rgba(28, 26, 13, 0.04)) 25%,
            var(--_surface-hover, rgba(28, 26, 13, 0.06)) 50%,
            var(--_surface-subtle, rgba(28, 26, 13, 0.04)) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
    }

    .shimmer-line:last-child {
        inline-size: 60%;
    }

    .spinner {
        display: inline-block;
        inline-size: var(--_tool-line-height);
        block-size: var(--_tool-line-height);
        border: calc(var(--_tool-line-height) * 0.125) solid var(--_border-subtle);
        border-block-start-color: var(--_text-secondary, #414651);
        border-radius: var(--_radius-round, 9999px);
        animation: spin 0.8s linear infinite;
    }

    @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .shimmer-line {
            animation: none;
        }

        .spinner {
            animation-duration: 1.6s;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .badge {
            border: var(--_card-border-width, 1px) solid currentColor;
            background: Canvas;
        }
    }
`,im=u`
    ${t=>t.state==="approval-requested"?u`
            <violet-approval-card
                class="approval-frame"
                part="root"
                state="pending"
                @approve="${(e,i)=>e.handleApprove(i.event)}"
                @deny="${(e,i)=>e.handleDeny(i.event)}"
            >
                <div slot="summary" class="approval-summary">
                    <span class="approval-tool-name">${e=>e.toolName}</span>
                    <slot name="summary" @slotchange="${e=>e.updateHasBody()}"></slot>
                </div>
                <div slot="detail" class="approval-detail" ?hidden="${e=>!e.hasDetailContent}">
                    <slot name="input" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot @slotchange="${e=>e.updateHasBody()}"></slot>
                </div>
            </violet-approval-card>
        `:u`
            <violet-card class="frame" part="root" appearance="outline" role="region" aria-label="${e=>`Tool: ${e.toolName}`}">
                <div class="header" part="header">
                    <span class="icon" part="icon">
                        <slot name="icon"><violet-icon icon="system/settings" decorative></violet-icon></slot>
                    </span>
                    <span class="name" part="name">${e=>e.toolName}</span>
                    <span class="badge" part="badge">${e=>e.badgeText()}</span>
                </div>
                <div class="body" part="body" ?hidden="${e=>e.state==="pending"||!e.hasBody}">
                    ${e=>e.state==="executing"?u`<span class="spinner" role="status" aria-label="Running"></span>`:""}
                    <slot name="summary" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot name="input" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot @slotchange="${e=>e.updateHasBody()}"></slot>
                </div>
                ${e=>e.state==="pending"?u`
                    <div class="body">
                        <div class="shimmer" role="status" aria-label="Loading">
                            <div class="shimmer-line"></div>
                            <div class="shimmer-line"></div>
                        </div>
                    </div>
                `:""}
                ${e=>e.state==="executing"&&!e.hasBody?u`
                    <div class="body">
                        <span class="spinner" role="status" aria-label="Running"></span>
                    </div>
                `:""}
            </violet-card>
        `}
`,Gt=class extends f{constructor(){super(),this.toolName="",this.toolCallId="",this.state="pending",this.hasBody=!1,this.hasDetailContent=!1}connectedCallback(){super.connectedCallback(),$s(),this.updateHasBody()}updateHasBody(){let e=this.shadowRoot?.querySelector('slot[name="summary"]'),i=this.shadowRoot?.querySelectorAll('slot[name="input"], slot[name="output"], .body > slot:not([name]), .approval-detail > slot:not([name])')??[],r=(e?.assignedNodes({flatten:!0})??[]).some(s=>s.nodeType===Node.TEXT_NODE?!!s.textContent?.trim():!0),o=!1;for(let s of i)if(s.assignedNodes({flatten:!0}).some(a=>a.nodeType!==Node.TEXT_NODE||!!a.textContent?.trim())){o=!0;break}this.hasBody=r||o,this.hasDetailContent=o}badgeText(){switch(this.state){case"pending":return"Preparing\u2026";case"executing":return"Running\u2026";case"approval-requested":return"Needs approval";case"output-available":return"Complete";case"output-error":return"Error";case"cancelled":return"Cancelled";default:return""}}handleApprove(e){e?.stopPropagation(),this.$emit("approve",{toolCallId:this.toolCallId})}handleDeny(e){e?.stopPropagation(),this.$emit("deny",{toolCallId:this.toolCallId})}};ac([m],Gt.prototype,"hasBody",void 0);ac([m],Gt.prototype,"hasDetailContent",void 0);c({attribute:"tool-name"})(Gt.prototype,"toolName");c({attribute:"tool-call-id"})(Gt.prototype,"toolCallId");c(Gt.prototype,"state");customElements.get("violet-tool-call-card")||await f.define(Gt,{name:"violet-tool-call-card",template:im,styles:tm});var rm=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},om=v`
    ${E}

    :host {
        display: block;
        --_result-font-size: var(--violet-result-font-size, var(--_caption-size, 12px));
        --_result-line-height: var(--violet-result-line-height, var(--_caption-line, 16px));
        --_success-text: var(--color-state-success-text, #166534);
    }

    .frame {
        display: block;
        --violet-card-border-color: var(--_border-subtle);
        --violet-card-background: var(--_surface-card);
        --violet-card-shadow: none;
    }

    .frame::part(root) {
        overflow: hidden;
    }

    :host([state="output-available"]) .frame {
        --violet-card-border-color: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
    }

    :host([state="output-error"]) .frame {
        --violet-card-border-color: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
    }

    .summary {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        font-family: inherit;
        font-size: var(--_result-font-size);
        line-height: var(--_result-line-height);
        color: var(--_text-secondary, #414651);
        cursor: pointer;
        border: none;
        background: none;
        inline-size: 100%;
        text-align: start;
    }

    .summary:hover {
        background: var(--_surface-hover, rgba(28, 26, 13, 0.06));
    }

    .summary:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .status-icon {
        flex-shrink: 0;
        display: inline-flex;
        --violet-icon-size: var(--_result-line-height);
    }

    :host([state="output-available"]) .status-icon {
        color: var(--_success-text);
    }

    :host([state="output-error"]) .status-icon {
        color: var(--color-state-danger-text, #b42318);
    }

    .summary-text {
        flex: 1;
        min-inline-size: 0;
    }

    slot[name="summary"]::slotted(*) {
        margin: 0;
    }

    .chevron {
        flex-shrink: 0;
        display: inline-flex;
        transition: transform 0.2s ease;
        --violet-icon-size: var(--_result-line-height);
    }

    :host([expanded]) .chevron {
        transform: rotate(90deg);
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        padding: var(--_space-xs, 4px) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid var(--_border-subtle);
        font-size: var(--_result-font-size);
        line-height: var(--_result-line-height);
        color: var(--_text-primary, #1c1a0d);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .body[hidden] {
        display: none;
    }

    .footer {
        display: grid;
        gap: var(--_space-stack-2xs);
        padding: var(--_space-xs, 4px) var(--_space-md);
        border-block-start: var(--_card-border-width, 1px) solid var(--_border-subtle);
        font-size: calc(var(--_result-font-size) * 0.85);
        color: var(--_text-secondary, #414651);
    }

    .footer[hidden] {
        display: none;
    }

    .body slot::slotted(*),
    slot[name="footer"]::slotted(*) {
        margin: 0;
    }

    .spinner {
        display: inline-block;
        inline-size: var(--_result-line-height);
        block-size: var(--_result-line-height);
        border: calc(var(--_result-line-height) * 0.125) solid var(--_border-subtle);
        border-block-start-color: var(--_text-secondary, #414651);
        border-radius: var(--_radius-round, 9999px);
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 1.6s;
        }

        .chevron {
            transition: none;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`,sm=u`
    <violet-card class="frame" part="root" appearance="outline">
        <button
            class="summary"
            part="summary"
            type="button"
            aria-expanded="${t=>String(t.expanded)}"
            @click="${t=>t.toggleExpanded()}"
        >
            <span class="status-icon" part="status-icon">
                ${t=>t.state==="output-error"?u`<violet-icon icon="system/dismiss" decorative></violet-icon>`:t.state==="output-available"?u`<violet-icon icon="system/checkmark" decorative></violet-icon>`:u`<span class="spinner" aria-label="In progress"></span>`}
            </span>
            <span class="summary-text">
                <slot name="summary">
                    ${t=>t.state==="output-error"?"Tool failed":t.state==="output-available"?"Tool completed":t.state==="executing"?"Tool running":"Waiting for output"}
                </slot>
            </span>
            <span class="chevron">
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </span>
        </button>
        <div class="body" part="body" ?hidden="${t=>!t.expanded}">
            <slot></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.expanded||!t.hasFooter}">
            <slot name="footer" @slotchange="${t=>t.handleFooterSlotChange()}"></slot>
        </div>
    </violet-card>
`,Di=class extends f{constructor(){super(),this.state="pending",this.expanded=!1,this.hasFooter=!1}connectedCallback(){super.connectedCallback(),gt(),Ae(),Be()}toggleExpanded(){this.expanded=!this.expanded}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};rm([m],Di.prototype,"hasFooter",void 0);c(Di.prototype,"state");c({mode:"boolean"})(Di.prototype,"expanded");customElements.get("violet-tool-result-card")||await f.define(Di,{name:"violet-tool-result-card",template:sm,styles:om});var cc=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s};Ne();var lc=0,nm=v`
    ${E}

    :host {
        --_dialog-border-width: var(--violet-dialog-border-width, var(--_card-border-width, 1px));
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-md));
        --_dialog-width: var(--violet-dialog-width, 35rem);
        --_dialog-margin: var(--violet-dialog-margin, 2rem);
        --_dialog-max-height: var(--violet-dialog-max-height, 85vh);
        --_dialog-radius: var(--violet-dialog-radius, var(--_radius-lg));
        --_dialog-background: var(--violet-dialog-background, var(--_surface-card));
        --_dialog-shadow: var(--violet-dialog-shadow, var(--_shadow-floating));
        --_dialog-backdrop: var(--violet-dialog-backdrop, rgba(0, 0, 0, 0.4));
        --_dialog-backdrop-off: transparent;
    }

    :host([no-backdrop]) {
        --_dialog-backdrop: transparent;
    }

    :host([padding="none"]) {
        --_dialog-padding: var(--violet-dialog-padding, 0);
    }

    :host([padding="small"]) {
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-sm));
    }

    :host([padding="large"]) {
        --_dialog-padding: var(--violet-dialog-padding, var(--_space-lg));
    }

    dialog {
        box-sizing: border-box;
        flex-direction: column;
        inline-size: var(--_dialog-width);
        max-inline-size: calc(100vw - var(--_dialog-margin));
        max-block-size: min(var(--_dialog-max-height), calc(100vh - var(--_dialog-margin)));
        margin: auto;
        padding: 0;
        border: var(--_dialog-border-width) solid var(--_border-subtle);
        border-radius: var(--_dialog-radius);
        background: var(--_dialog-background);
        box-shadow: var(--_dialog-shadow);
        color: inherit;
        font-family: inherit;
        overflow: hidden;

        /*
         * Opacity only: any \`transform\` (even a transitional one) makes the dialog the containing
         * block of its \`position: fixed\` descendants, so popups slotted into it would be placed
         * against the dialog instead of the viewport while it animates.
         */
        opacity: 0;
        transition:
            opacity var(--_duration-base) var(--_easing-standard),
            display var(--_duration-base) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
    }

    /*
     * Only lay the dialog out while it is open. A base \`display\` would override the UA's
     * \`dialog:not([open]) { display: none }\`, leaving a closed dialog rendered (just
     * transparent) with its controls still in the tab order. The \`display ... allow-discrete\`
     * transition above keeps the fade-out.
     */
    dialog[open] {
        display: flex;
        opacity: 1;

        @starting-style {
            opacity: 0;
        }
    }

    dialog::backdrop {
        background: var(--_dialog-backdrop-off);
        transition:
            background var(--_duration-base) var(--_easing-standard),
            display var(--_duration-base) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
    }

    dialog[open]::backdrop {
        background: var(--_dialog-backdrop);

        @starting-style {
            background: var(--_dialog-backdrop-off);
        }
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_dialog-padding);
        border-block-end: var(--_dialog-border-width) solid var(--_border-subtle);
    }

    .header[hidden] {
        display: none;
    }

    .title {
        flex: 1;
        font-weight: 600;
        min-inline-size: 0;
    }

    .close-button {
        flex-shrink: 0;
    }

    .close-button[hidden] {
        display: none;
    }

    .body {
        flex: 1;
        padding: var(--_dialog-padding);
        overflow-y: auto;
    }

    .footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--_space-sm);
        padding: var(--_dialog-padding);
        border-block-start: var(--_dialog-border-width) solid var(--_border-subtle);
    }

    .footer[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        dialog {
            forced-color-adjust: none;
            border: var(--_dialog-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        dialog::backdrop {
            background: var(--_dialog-backdrop);
        }

        .header {
            border-block-end-color: ButtonText;
        }

        .footer {
            border-block-start-color: ButtonText;
        }

    }
`,am=u`
    <dialog
        part="dialog"
        id="${t=>t.dialogId}"
        aria-labelledby="${t=>t.hasTitle?t.titleId:void 0}"
        aria-label="${t=>t.hasTitle?void 0:"Dialog"}"
        @close="${(t,e)=>t.handleClose(e.event)}"
        @cancel="${(t,e)=>t.handleCancel(e.event)}"
    >
        <div class="header" part="header" ?hidden="${t=>!t.hasTitle&&t.noCloseButton}">
            <span class="title" part="title" id="${t=>t.titleId}">
                <slot name="title" @slotchange="${t=>t.handleTitleSlotChange()}"></slot>
            </span>
            <violet-icon-button
                class="close-button"
                part="close-button"
                ?hidden="${t=>t.noCloseButton}"
                appearance="quiet"
                label="Close"
                @click="${t=>t.requestClose("close-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
        <div class="body" part="body" id="${t=>t.bodyId}" tabindex="${t=>t.bodyScrollable?"0":null}">
            <slot @slotchange="${t=>t.handleBodySlotChange()}"></slot>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter}">
            <slot name="footer" @slotchange="${t=>t.handleFooterSlotChange()}"></slot>
        </div>
    </dialog>
`;function lm(){let t=document.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t}var Ke=class extends f{#e=null;#t=!1;#i=null;constructor(){super(),this.hasTitle=!1,this.hasFooter=!1,this.bodyScrollable=!1,this.open=!1,this.type="modal",this.padding="medium",this.noCloseButton=!1,this.noBackdrop=!1;let e=lc;lc+=1,this.dialogId=`violet-dialog-${e}`,this.titleId=`violet-dialog-title-${e}`,this.bodyId=`violet-dialog-body-${e}`}get returnValue(){return this.#r?.returnValue??""}set returnValue(e){let i=this.#r;i&&(i.returnValue=e)}get#r(){return this.shadowRoot?.querySelector("dialog")??null}show(){this.open=!0}hide(e){let i=this.#r;i&&e!==void 0&&(i.returnValue=e),this.open=!1}openChanged(){this.$fastController.isConnected&&(this.open?this.#n():this.#s())}typeChanged(){this.#l()}connectedCallback(){super.connectedCallback(),this.open&&this.#n()}disconnectedCallback(){this.#i?.disconnect(),this.#i=null,super.disconnectedCallback()}handleClose(e){this.#t=!0,this.open=!1,this.#t=!1,this.#i?.disconnect(),this.bodyScrollable=!1,this.$emit("open-change",{open:!1});let i=this.#e;i instanceof HTMLElement&&i.isConnected&&i.focus(),this.#e=null}handleBodySlotChange(){this.open&&this.#o()}handleCancel(e){e.preventDefault(),this.requestClose("keyboard")}requestClose(e){let i=new CustomEvent("request-close",{bubbles:!0,composed:!0,cancelable:!0,detail:{source:e}});this.dispatchEvent(i),i.defaultPrevented||this.hide()}handleTitleSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="title"]');this.hasTitle=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#n(){let e=this.#r;!e||e.open||(this.#e=lm(),this.#l(),this.type==="non-modal"?e.show():e.showModal(),this.#o(),this.$emit("open-change",{open:!0}))}#s(){let e=this.#r;e?.open&&(this.#t||e.close())}#o(){let e=this.shadowRoot?.querySelector(".body");if(!e)return;this.#i??=new ResizeObserver(()=>this.#a()),this.#i.disconnect(),this.#i.observe(e);let i=e.querySelector("slot");for(let r of i?.assignedElements({flatten:!0})??[])this.#i.observe(r);this.#a()}#a(){let e=this.shadowRoot?.querySelector(".body");this.bodyScrollable=!!(e&&e.scrollHeight>e.clientHeight)}#l(){let e=this.#r;e&&(this.type==="alert"?(e.setAttribute("role","alertdialog"),e.setAttribute("aria-describedby",this.bodyId),e.setAttribute("closedby","none")):this.type==="non-modal"?(e.removeAttribute("role"),e.removeAttribute("aria-describedby"),e.setAttribute("closedby","any")):(e.removeAttribute("role"),e.removeAttribute("aria-describedby"),e.setAttribute("closedby","closerequest")))}};cc([m],Ke.prototype,"hasTitle",void 0);cc([m],Ke.prototype,"hasFooter",void 0);m(Ke.prototype,"bodyScrollable");c({mode:"boolean"})(Ke.prototype,"open");c(Ke.prototype,"type");c(Ke.prototype,"padding");c({attribute:"no-close-button",mode:"boolean"})(Ke.prototype,"noCloseButton");c({attribute:"no-backdrop",mode:"boolean"})(Ke.prototype,"noBackdrop");customElements.get("violet-dialog")||await f.define(Ke,{name:"violet-dialog",template:am,styles:nm});function dc(t){return typeof t=="object"?t.key:t}function uc(t,e){let i=t.length;return new Proxy(t,{get(r,o,s){if(typeof o=="string"){let n=o.charCodeAt(0);if(n>=48&&n<=57){let a=+o;if(Number.isInteger(a)&&a>=0&&a<i){let l=r[a];if(typeof l!="object"){let d=e[a*2];l=r[a]={index:a,key:l,start:d,size:e[a*2+1],end:d+e[a*2+1],lane:0}}return l}}if(o==="length")return i}return Reflect.get(r,o,s)}})}function li(t,e,i){let r=i.initialDeps??[],o,s=!0;function n(){var a;let d=0,h=t();if(!(h.length!==r.length||h.some((k,S)=>r[S]!==k)))return o;r=h;let x=0;return o=e(...h),i?.onChange&&!(s&&i.skipInitialOnChange)&&i.onChange(o),s=!1,o}return n.updateDeps=a=>{r=a},n}function nn(t,e){if(t===void 0)throw new Error(`Unexpected undefined${e?`: ${e}`:""}`);return t}var St=(t,e)=>Math.abs(t-e)<1.01,hc=(t,e,i)=>{let r;return Object.assign(function(...o){t.clearTimeout(r),r=t.setTimeout(()=>e.apply(this,o),i)},{cancel:()=>{t.clearTimeout(r)}})};function pc({offset:t,isScrolling:e,elementMax:i,holdOffset:r,scrollOffset:o,pendingWrite:s,clampedMaxAtWrite:n}){var a;return e&&s===null&&t===o?"spurious":s!==null&&Math.abs(t-s.target)<1.5?"readBack":s!==null&&!s.smooth&&i!==null&&s.target>i+r+.5&&Math.abs(t-(i+r))<1.5||s!==null&&!s.smooth&&((a=s.lowMaxes)!=null&&a.some(l=>Math.abs(t-l)<1.5))?"clampedReadBack":n!==null&&Math.abs(t-n)<1.5?"clampedEcho":"external"}var cm=t=>t==="smooth"||t==="smoothFinishing";function fc({kind:t,offset:e,command:i,target:r}){return t!=="spurious"&&t!=="readBack"&&t!=="clampedReadBack"&&i?.index!=null&&i.phase!=="queued"&&!cm(i.phase)&&!St(e,i.lastTargetOffset)&&!St(e,r())&&t!=="clampedEcho"}var an=40;function mc(t){let e=t[t.length-1];if(e===void 0)return!1;let i=t.length-2;for(;i>=0&&e.t-t[i].t<an;)i--;if(i<0)return!1;let r=t[i],o=i-1;for(;o>=0&&r.t-t[o].t<an;)o--;if(o<0)return!1;let s=t[o],n=(e.offset-r.offset)/(e.t-r.t),a=(r.offset-s.offset)/(r.t-s.t);return n*a>=0&&Math.abs(n)>=2*Math.abs(a)&&Math.abs(n)-Math.abs(a)>=.8}function gc(t){let e=t[t.length-1];if(e===void 0)return!1;let i=t.length-2;for(;i>=0&&e.t-t[i].t<an;)i--;if(i<0)return!1;let r=t[i];return Math.abs(e.offset-r.offset)/(e.t-r.t)>=.05}var Dr,Mr=()=>{if(Dr!==void 0)return Dr;if(typeof navigator>"u")return Dr=!1;if(/iP(hone|od|ad)/.test(navigator.userAgent))return Dr=!0;let t=navigator.maxTouchPoints;return Dr=navigator.platform==="MacIntel"&&t!==void 0&&t>0},ln,dm=()=>ln!==void 0?ln:ln=Mr()&&typeof CSS<"u"&&typeof CSS.supports=="function"&&CSS.supports("overflow-anchor: auto"),vc=()=>!Mr()||dm();var Mi={capture:!0,passive:!0},$o=class{constructor(e){this.host=e,this._touch=null,this.inMotion=()=>this._touch!==null&&this._touch.phase!=="lateFling",this.dragging=()=>{var i;return((i=this._touch)==null?void 0:i.phase)==="down"&&this._touch.moved},this.tail=()=>{var i;return((i=this._touch)==null?void 0:i.phase)==="tail"?this._touch.moved?"fling":"tap":null},this.onScroll=({isScrolling:i,ownReadBack:r,moved:o,external:s})=>{var n,a,l;return i&&((n=this._touch)==null?void 0:n.phase)==="tail"?this._openTail(this._touch.moved||!r,!1):((a=this._touch)==null?void 0:a.phase)==="lateFling"&&(this.host.now()>this._touch.until?this._touch=null:s&&i&&o&&this._openTail(!0,!1)),!r&&i&&o&&((l=this._touch)==null?void 0:l.phase)==="down"?(this._touch.moved=!0,!0):!1},this.touchStart=()=>{this.end(),this._touch={phase:"down",moved:!1}},this.touchEnd=()=>{var i;let r=((i=this._touch)==null?void 0:i.phase)==="down"&&this._touch.moved;this.end(),this._openTail(r,r)},this.end=()=>{var i;let r=this.host.getWindow();((i=this._touch)==null?void 0:i.phase)==="tail"&&r!=null&&r.clearTimeout(this._touch.timerId),this._touch=null},this.listen=i=>{let r=()=>this.touchStart(),o=()=>this.touchEnd();return i.addEventListener("touchstart",r,Mi),i.addEventListener("touchend",o,Mi),i.addEventListener("touchcancel",o,Mi),()=>{i.removeEventListener("touchstart",r,Mi),i.removeEventListener("touchend",o,Mi),i.removeEventListener("touchcancel",o,Mi),this.end()}},this._openTail=(i,r)=>{let o=this.host.getWindow();if(o==null)return;this.end();let s={phase:"tail",moved:i,awaitingFling:r,timerId:o.setTimeout(()=>{if(this.host.tailStillMoving()){this._openTail(s.moved,s.awaitingFling);return}this._touch=s.awaitingFling?{phase:"lateFling",until:this.host.now()+1e3}:null,this.host.onTailClosed()},150)};this._touch=s}}get touch(){return this._touch}};var bc=t=>{let{clientWidth:e,clientHeight:i}=t;return{width:e,height:i}},wc=t=>{let e=new Set;return{schedule:i=>{let r=t.requestAnimationFrame(()=>{e.delete(r),i()});e.add(r)},cancel:()=>{e.forEach(i=>t.cancelAnimationFrame(i)),e.clear()}}},um=t=>t,hm=t=>{let e=t.overscan*Math.max(t.lanes??1,1),i=Math.max(t.startIndex-e,0),o=Math.min(t.endIndex+e,t.count-1)-i+1,s=new Array(o);for(let n=0;n<o;n++)s[n]=i+n;return s},_c=(t,e)=>{let i=t.scrollElement;if(!i)return;let r=t.targetWindow;if(!r)return;let o=a=>{let{width:l,height:d}=a;e({width:Math.round(l),height:Math.round(d)})};if(o(bc(i)),!r.ResizeObserver)return()=>{};let s=wc(r),n=new r.ResizeObserver(()=>{let a=()=>{o(bc(i))};t.options.useAnimationFrameWithResizeObserver?s.schedule(a):a()});return n.observe(i,{box:"content-box"}),()=>{n.unobserve(i),s.cancel()}},yc={passive:!0};var pm=typeof window>"u"?!0:"onscrollend"in window,fm=(t,e,i)=>{let r=t.scrollElement;if(!r)return;let o=t.targetWindow;if(!o)return;let s=t.options.useScrollendEvent&&pm,n=0,a=s?null:hc(o,()=>e(i(r),!1),t.options.isScrollingResetDelay),l=p=>()=>{n=i(r),a?.(),e(n,p)},d=l(!0),h=l(!1);return r.addEventListener("scroll",d,yc),s&&r.addEventListener("scrollend",h,yc),()=>{r.removeEventListener("scroll",d),s&&r.removeEventListener("scrollend",h),a?.cancel()}},kc=(t,e)=>fm(t,e,i=>{let{horizontal:r,isRtl:o}=t.options;return r?i.scrollLeft*(o&&-1||1):i.scrollTop});var mm=(t,e,i)=>{if(i.options.useCachedMeasurements){let r=i.indexFromElement(t),o=i.options.getItemKey(r);return i.itemSizeCache.get(o)??i.options.estimateSize(r)}if(e?.borderBoxSize){let r=e.borderBoxSize[0];if(r)return Math.round(r[i.options.horizontal?"inlineSize":"blockSize"])}if(!e){let r=i.indexFromElement(t),o=i.options.getItemKey(r),s=i.itemSizeCache.get(o);if(s!==void 0)return s}return t[i.options.horizontal?"offsetWidth":"offsetHeight"]},gm=(t,{adjustments:e=0,behavior:i},r)=>{var o;let{scrollElement:s,options:n}=r,a=t+e,l=n.horizontal&&n.isRtl&&s!==null&&"ownerDocument"in s;(o=s?.scrollTo)==null||o.call(s,{[n.horizontal?"left":"top"]:l?-a:a,behavior:i})};var Cc=gm,xc=(t,e)=>t==="smooth"?e?"smoothLanded":"smooth":"instant",Or=t=>t?.phase==="smooth"||t?.phase==="smoothLanded";function vm(t,e,i,r){if(e===0)return!1;let o=r(0),s=new Set,n=0;for(;n<t;){let l=i(n);if(l===o)break;s.add(l),n++}let a=t-n;if(a===0||a>=e)return!1;for(let l=0;l<a;l++)if(r(l)!==i(n+l))return!1;for(let l=a;l<e;l++)if(s.has(r(l)))return!1;return!0}var Eo=class{constructor(e){this.unsubs=[],this.scrollElement=null,this.targetWindow=null,this.isScrolling=!1,this.scrollState=null,this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache=new Map,this.itemSizeCacheVersion=0,this.laneAssignments=new Map,this.pendingMin=null,this.prevLanes=void 0,this.lanesChangedFlag=!1,this.lanesSettling=!1,this.pendingScrollAnchor=null,this.scrollRect=null,this.scrollOffset=null,this.scrollDirection=null,this._holdOffset=0,this._reportedOverscroll=!1,this._iosGesture=new $o({getWindow:()=>this.targetWindow,now:()=>this.now(),tailStillMoving:()=>{let i=this.scrollState;if(i?.phase!=="queued"||this.pendingWrite!==null)return!1;let r=this._readElementOffset();return r===null||this._lastElementOffset===null||Math.abs(r-this._lastElementOffset)<1?!1:(this._lastElementOffset=r,i.samples=[...i.samples??[],{t:this.now(),offset:r}],!0)},onTailClosed:()=>{let i=this.scrollState;i?.phase==="queued"&&gc(i.samples??[])&&(this.scrollState=null),this._flushHoldIfReady(!0),this._writeAwaitingCommand(),this._retryClampedAdjustment()}}),this._lastElementOffset=null,this.pendingWrite=null,this._clampedAdjustment=null,this.elementsCache=new Map,this._resizeBatch=null,this.now=()=>{var i,r,o;return((o=(r=(i=this.targetWindow)==null?void 0:i.performance)==null?void 0:r.now)==null?void 0:o.call(r))??Date.now()},this.observer=(()=>{let i=null,r=null,o=!1,s=!1,n=new Set,a=()=>{if(i)return i;let d=this.targetWindow;if(!d||!d.ResizeObserver)return null;let h=r=wc(d);return i=new d.ResizeObserver(p=>{let x=()=>{let k={sync:!1};this._resizeBatch=k;try{p.forEach(l)}finally{this._resizeBatch=null,k.notify&&(this.notify(k.sync),this._noteClampMax(),this._flushHoldIfReady(!0),this._retryClampedAdjustment(),this.measureElement(null))}};if(this.options.useAnimationFrameWithResizeObserver)h.schedule(x);else{o=!0;try{x()}finally{o=!1}}})},l=d=>{let h=d.target,p=this.indexFromElement(h);if(!h.isConnected){this.observer.unobserve(h);for(let[x,k]of this.elementsCache)if(k===h){this.elementsCache.delete(x);break}return}this.isIndexInRange(p)&&this.shouldMeasureDuringScroll(p)&&this.resizeItem(p,this.options.measureElement(h,d,this))};return{disconnect:()=>{var d;(d=a())==null||d.disconnect(),r?.cancel(),n.clear(),s=!1,i=null,r=null},observe:d=>{let h=a();if(h){if(!o){h.observe(d,{box:"border-box"});return}n.add(d),s||(s=!0,r?.schedule(()=>{s=!1,n.forEach(p=>{p.isConnected&&i?.observe(p,{box:"border-box"})}),n.clear()}))}},unobserve:d=>{var h;n.delete(d),(h=a())==null||h.unobserve(d)}}})(),this.range=null,this.setOptions=i=>{var r;let o={debug:!1,initialOffset:0,overscan:1,paddingStart:0,paddingEnd:0,scrollPaddingStart:0,scrollPaddingEnd:0,horizontal:!1,getItemKey:um,rangeExtractor:hm,onChange:()=>{},measureElement:mm,initialRect:{width:0,height:0},scrollMargin:0,gap:0,indexAttribute:"data-index",initialMeasurementsCache:[],lanes:1,anchorTo:"start",followOnAppend:!1,scrollEndThreshold:1,isScrollingResetDelay:150,enabled:!0,isRtl:!1,useScrollendEvent:!1,useAnimationFrameWithResizeObserver:!1,laneAssignmentMode:"estimate",useCachedMeasurements:!1};for(let h in i){let p=i[h];p!==void 0&&(o[h]=p)}let s=this.options,n=null,a=null,l=!1;if(s!==void 0&&s.enabled&&o.enabled&&o.anchorTo==="end"&&this.scrollElement!==null){let h=s.count,p=o.count,x=this.getMeasurements(),k=((r=this._singleLaneMeasurements)==null?void 0:r.items)??x,S=I=>dc(k[I]),A=h>0?S(0):null,D=h>0?S(h-1):null;if(p!==h||h>0&&p>0&&(o.getItemKey(0)!==A||o.getItemKey(p-1)!==D)){l=!0;let I=h>0?this.getVirtualItemForOffset(this.getScrollOffset())??x[0]:null;I&&(n=[I.key,this.getScrollOffset()-I.start]);let M=o.followOnAppend===!0?"auto":o.followOnAppend||null;M&&p>0&&this.isAtEnd(s.scrollEndThreshold)&&(h===0||o.getItemKey(p-1)!==D)&&(p>h||vm(h,p,S,o.getItemKey))&&(a=M)}}this.options=o,l&&(this.pendingMin=0,this.itemSizeCacheVersion++);let d=null;if(n&&this.scrollOffset!==null&&!this._awaitingCommandReadBack()){let[h,p]=n,x=this.getMeasurements(),{count:k,getItemKey:S}=this.options,A=0;for(;A<k&&S(A)!==h;)A++;if(A<k){let D=x[A];if(D){let _=Math.max(0,D.start+p);!a&&_!==this.scrollOffset&&(d=_-this.scrollOffset,this.scrollOffset=_)}}}a?this.pendingScrollAnchor={kind:"follow",behavior:a}:d!==null&&(this._canWriteScroll()?this.pendingScrollAnchor={kind:"anchor",delta:d}:(this._holdOffset+=d,this._followOffsetTarget(d)))},this.notify=i=>{var r,o;(o=(r=this.options).onChange)==null||o.call(r,this,i)},this.maybeNotify=li(()=>(this.calculateRange(),[this.isScrolling,this.range?this.range.startIndex:null,this.range?this.range.endIndex:null]),i=>{this.notify(i)},{key:!1,debug:()=>this.options.debug,initialDeps:[this.isScrolling,this.range?this.range.startIndex:null,this.range?this.range.endIndex:null]}),this.cleanup=()=>{var i;this.unsubs.filter(Boolean).forEach(r=>r()),this.unsubs=[],this.observer.disconnect(),this.rafId!=null&&this.targetWindow&&(this.targetWindow.cancelAnimationFrame(this.rafId),this.rafId=null),this.scrollState=null,(i=this._momentumStop)==null||i.restore(),this._momentumStop=null,this.isScrolling=!1,this.scrollDirection=null,this._holdOffset=0,this._reportedOverscroll=!1,this._clampedAdjustment=null,this.pendingWrite=null,this.scrollElement=null,this.targetWindow=null},this._didMount=()=>()=>{this.cleanup()},this._willUpdate=()=>{var i;let r=this.options.enabled?this.options.getScrollElement():null;if(this.scrollElement!==r){if(this.cleanup(),!r){this.maybeNotify();return}this.scrollElement=r,this.scrollElement&&"ownerDocument"in this.scrollElement?this.targetWindow=this.scrollElement.ownerDocument.defaultView:this.targetWindow=((i=this.scrollElement)==null?void 0:i.window)??null,this.elementsCache.forEach(s=>{this.observer.observe(s)}),this.unsubs.push(this.options.observeElementRect(this,s=>{this.scrollRect=s,this.maybeNotify()})),this.unsubs.push(this.options.observeElementOffset(this,(s,n)=>{var a,l,d,h;let p=n?this._elementMaxScrollOffset():null,x=this._reportedOverscroll;this._reportedOverscroll=s<0||p!==null&&s>p+1;let k=s;this._lastElementOffset=k,s=this._toLayoutOffset(s);let S=this._classifyScrollEvent(s,n,p);if(S==="spurious")return;S==="readBack"?s=this.pendingWrite.target:S==="clampedReadBack"&&((a=this.scrollState)==null?void 0:a.index)!=null&&s<this.getMaxScrollOffset()-1.5?this.scrollState.lastTargetOffset=s:fc({kind:S,offset:s,command:this.scrollState,target:()=>this.getScrollStateTarget(this.scrollState)})&&(this.scrollState=null),this.pendingWrite=null,this._clampedAdjustment!==null&&Math.abs(s-this._clampedAdjustment.maxAtWrite)>=1.5&&(this._clampedAdjustment=null);let A=this.getScrollOffset(),D=this.scrollDirection;this.scrollDirection=n?A===s?this.scrollDirection:A<s?"forward":"backward":null,this.scrollOffset=s,this.isScrolling=n;let _=this.scrollState;if(_?.phase==="queued"&&S==="external"&&n)if(x||this._reportedOverscroll)_.samples=[];else{let T=this.now();_.samples=[...(_.samples??[]).filter(I=>T-I.t<=200),{t:T,offset:k}],(D!==null&&this.scrollDirection!==D||mc(_.samples))&&(this.scrollState=null)}this._iosGesture.onScroll({isScrolling:n,ownReadBack:S==="readBack",moved:s!==A,external:S==="external"&&((l=this.scrollState)==null?void 0:l.phase)!=="smooth"&&((d=this.scrollState)==null?void 0:d.phase)!=="smoothFinishing"})&&((h=this.scrollState)==null?void 0:h.phase)==="queued"&&(this.scrollState=null),this._flushHoldIfReady(!0),this.scrollState&&this.scheduleScrollReconcile(),this.maybeNotify()})),"addEventListener"in this.scrollElement&&this.unsubs.push(this._iosGesture.listen(this.scrollElement)),this._scrollToOffset(this.getScrollOffset())}this._noteClampMax();let o=this.pendingScrollAnchor;this.pendingScrollAnchor=null,o&&this.scrollElement&&this.options.enabled&&(o.kind==="anchor"?this._canWriteScroll()?Or(this.scrollState)&&!St(this.getScrollOffset()-o.delta,this.scrollState.lastTargetOffset)||(this._followOffsetTarget(o.delta),this._scrollToOffset(this.getScrollOffset())):(this._holdOffset+=o.delta,this._followOffsetTarget(o.delta),this.notify(!1)):this.scrollToEnd({behavior:o.behavior})),this._flushHoldIfReady(!1),this._retryClampedAdjustment()},this._classifyScrollEvent=(i,r,o)=>{var s;return pc({offset:i,isScrolling:r,elementMax:o,holdOffset:this._holdOffset,scrollOffset:this.scrollOffset,pendingWrite:this.pendingWrite,clampedMaxAtWrite:((s=this._clampedAdjustment)==null?void 0:s.maxAtWrite)??null})},this._retryClampedAdjustment=()=>{if(this._clampedAdjustment===null||!this.scrollElement||!this.options.enabled||!this._canWriteScroll())return;let{target:i,maxAtWrite:r}=this._clampedAdjustment,o=this.getMaxScrollOffset();o>r+.5&&(this._clampedAdjustment=i>o+.5?{target:i,maxAtWrite:o}:null,this._scrollToOffset(i))},this._writeAwaitingCommand=()=>{let i=this.scrollState;if(i===null||i.phase!=="queued")return;let{behavior:r}=i;this.getMeasurements();let o=this.getScrollStateTarget(i);i.lastTargetOffset=o,this._clampedAdjustment=null,i.phase=xc(r,i.index!=null&&St(o,this.getScrollOffset())),this._scrollToOffset(o,{behavior:r}),this.scheduleScrollReconcile()},this._readElementOffset=()=>{let i=this.scrollElement;if(i==null)return null;let{horizontal:r,isRtl:o}=this.options;return typeof i.scrollTop=="number"?r?i.scrollLeft*(o&&-1||1):i.scrollTop:typeof i.scrollY=="number"?r?i.scrollX:i.scrollY:null},this._canWriteScroll=()=>!(Mr()&&this._iosGesture.inMotion())&&!this._reportedOverscroll,this._flushHoldIfReady=i=>{var r;if(this._holdOffset===0||!this.scrollElement||!this.options.enabled||!this._canWriteScroll()||((r=this.scrollState)==null?void 0:r.phase)==="smooth")return;this._holdOffset=0,this.scrollOffset!==null&&this.scrollOffset<0&&(this.scrollOffset=0),this.notify(i);let o=this.getCommandWrittenOffset()??this.getScrollOffset();this._clampedAdjustment=this._clampedBy(o),this._scrollToOffset(o)},this.rafId=null,this.getSize=()=>this.options.enabled?(this.scrollRect=this.scrollRect??this.options.initialRect,this.scrollRect[this.options.horizontal?"width":"height"]):(this.scrollRect=null,0),this.getScrollOffset=()=>this.options.enabled?(this.scrollOffset=this.scrollOffset??(typeof this.options.initialOffset=="function"?this.options.initialOffset():this.options.initialOffset),this.scrollOffset):(this.scrollOffset=null,0),this.getMeasurementOptions=li(()=>[this.options.count,this.options.paddingStart,this.options.scrollMargin,this.options.getItemKey,this.options.enabled,this.options.lanes,this.options.laneAssignmentMode,this.options.gap],(i,r,o,s,n,a,l,d)=>(this.prevLanes!==void 0&&this.prevLanes!==a&&(this.lanesChangedFlag=!0),this.prevLanes=a,this.pendingMin=null,{count:i,paddingStart:r,scrollMargin:o,getItemKey:s,enabled:n,lanes:a,laneAssignmentMode:l,gap:d}),{key:!1}),this.isIndexInRange=i=>i>=0&&i<this.options.count,this.getMeasurements=li(()=>[this.getMeasurementOptions(),this.itemSizeCacheVersion],({count:i,paddingStart:r,scrollMargin:o,getItemKey:s,enabled:n,lanes:a,laneAssignmentMode:l,gap:d},h)=>{var p;let x=this.itemSizeCache;if(!n)return this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),[];if(this.laneAssignments.size>i)for(let T of this.laneAssignments.keys())T>=i&&this.laneAssignments.delete(T);this.lanesChangedFlag&&(this.lanesChangedFlag=!1,this.lanesSettling=!0,this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),this.pendingMin=null),this.measurementsCache.length===0&&!this.lanesSettling&&(this.measurementsCache=this.options.initialMeasurementsCache,this.measurementsCache.forEach(T=>{this.itemSizeCache.set(T.key,T.size)}));let k=this.lanesSettling?0:this.pendingMin??0;if(this.pendingMin=null,this.lanesSettling&&this.measurementsCache.length===i&&(this.lanesSettling=!1),a===1){let T=i*2,I=(p=this._singleLaneMeasurements)==null?void 0:p.flat;if(!I||I.length<T){let j=new Float64Array(T);I&&k>0&&j.set(I.subarray(0,k*2)),I=j}let M=k===0?new Array(i):this._singleLaneMeasurements.items.slice(),V;if(k===0)V=r+o;else{let j=k-1;V=I[j*2]+I[j*2+1]+d}for(let j=k;j<i;j++){let le=s(j);M[j]=le;let ge=x.get(le),Ze=typeof ge=="number"?ge:this.options.estimateSize(j);I[j*2]=V,I[j*2+1]=Ze,V+=Ze+d}this._singleLaneMeasurements={flat:I,items:M};let O=uc(M,I);return this.measurementsCache=O,O}let S=this.measurementsCache.slice(0,k),A=new Array(a).fill(void 0),D=new Float64Array(a),_=0;for(let T=0;T<k;T++){let I=S[T];I&&(A[I.lane]===void 0&&_++,A[I.lane]=T,D[I.lane]=I.end)}for(let T=k;T<i;T++){let I=s(T),M=this.laneAssignments.get(T),V,O,j=l==="estimate"||x.has(I);if(M!==void 0&&this.options.lanes>1){V=M;let Ie=A[V],De=Ie!==void 0?S[Ie]:void 0;O=De?De.end+d:r+o}else if(_===a){let Ie=0,De=D[0],Ot=A[0];for(let et=1;et<a;et++){let lr=D[et];(lr<De||lr===De&&A[et]<Ot)&&(Ie=et,De=lr,Ot=A[et])}V=Ie,O=De+d,j&&this.laneAssignments.set(T,V)}else V=T%this.options.lanes,O=r+o,j&&this.laneAssignments.set(T,V);let le=x.get(I),ge=typeof le=="number"?le:this.options.estimateSize(T),Ze=O+ge;S[T]={index:T,start:O,size:ge,end:Ze,key:I,lane:V},A[V]===void 0&&_++,A[V]=T,D[V]=Ze}return this.measurementsCache=S,S},{key:!1,debug:()=>this.options.debug}),this.calculateRange=li(()=>[this.getMeasurements(),this.getSize(),this.getScrollOffset(),this.options.lanes,this._getLayoutTotalSize()+this.options.scrollMargin],(i,r,o,s,n)=>{if(i.length===0||r===0)return this.range=null,null;let a=Math.max(n-r,0);return this.range=ym(i,r,Math.min(o,a),s,s===1&&this._singleLaneMeasurements!==null?this._singleLaneMeasurements.flat:null),this.range},{key:!1,debug:()=>this.options.debug}),this.getVirtualIndexes=li(()=>{let i=null,r=null,o=this.calculateRange();return o&&(i=o.startIndex,r=o.endIndex),this.maybeNotify.updateDeps([this.isScrolling,i,r]),[this.options.rangeExtractor,this.options.overscan,this.options.count,i,r,this.options.lanes]},(i,r,o,s,n,a)=>s===null||n===null?[]:i({startIndex:s,endIndex:n,overscan:r,count:o,lanes:a}),{key:!1,debug:()=>this.options.debug}),this.indexFromElement=i=>{let r=this.options.indexAttribute,o=i.getAttribute(r);return o?parseInt(o,10):(console.warn(`Missing attribute name '${r}={index}' on measured element.`),-1)},this.shouldMeasureDuringScroll=i=>{var r;if(!Or(this.scrollState))return!0;let o=this.scrollState.index??((r=this.getVirtualItemForOffset(this.scrollState.lastTargetOffset))==null?void 0:r.index);if(o!==void 0&&this.range){let s=Math.max(this.options.overscan,Math.ceil((this.range.endIndex-this.range.startIndex)/2)),n=Math.max(0,o-s),a=Math.min(this.options.count-1,o+s);return i>=n&&i<=a}return!0},this.measureElement=i=>{if(!i){this.elementsCache.forEach((n,a)=>{n.isConnected||(this.observer.unobserve(n),this.elementsCache.delete(a))});return}let r=this.indexFromElement(i);if(!this.isIndexInRange(r))return;let o=this.options.getItemKey(r),s=this.elementsCache.get(o);s!==i&&(s&&this.observer.unobserve(s),this.observer.observe(i),this.elementsCache.set(o,i)),i.isConnected&&(!this.isScrolling||this.scrollState)&&this.shouldMeasureDuringScroll(r)&&this.resizeItem(r,this.options.measureElement(i,void 0,this))},this.resizeItem=(i,r)=>{var o,s,n;if(!this.isIndexInRange(i))return;(o=this._resizeBatch)!=null&&o.sync&&this.getMeasurements();let a,l,d,h=(s=this._singleLaneMeasurements)==null?void 0:s.flat;if(this.options.lanes===1&&h!=null)d=this.options.getItemKey(i),l=h[i*2],a=h[i*2+1];else{let k=this.measurementsCache[i];if(!k)return;d=k.key,l=k.start,a=k.size}let p=this.itemSizeCache.get(d)??a,x=r-p;if(x!==0){let k=this.options.anchorTo==="end"&&!Or(this.scrollState)&&this.getVirtualDistanceFromEnd()<=this.options.scrollEndThreshold,S=k?this._getLayoutTotalSize():0,A=this.getScrollOffset(),_=!this.itemSizeCache.has(d)?l<A:l+p<=A&&this.scrollDirection!=="backward",T=!Or(this.scrollState)&&(this.shouldAdjustScrollPositionOnItemSizeChange!==void 0?this.shouldAdjustScrollPositionOnItemSizeChange(this.measurementsCache[i]??{index:i,key:d,start:l,size:a,end:l+a,lane:0},x,this):_);(this.pendingMin===null||i<this.pendingMin)&&(this.pendingMin=i),this.itemSizeCache.set(d,r),this.itemSizeCacheVersion++;let I=!1;if(this._awaitingCommandReadBack()||(k?I=this.applyScrollAdjustment(this._getLayoutTotalSize()-S):T&&(I=this.applyScrollAdjustment(x))),this._resizeBatch){this._resizeBatch.notify=!0,(n=this._resizeBatch).sync||(n.sync=I);return}this.notify(I),this._noteClampMax(),this._flushHoldIfReady(!0),this._retryClampedAdjustment()}},this.getVirtualItems=li(()=>[this.getVirtualIndexes(),this.getMeasurements(),this._holdOffset],(i,r,o)=>{let s=[];for(let n=0,a=i.length;n<a;n++){let l=i[n],d=r[l];s.push(o===0?d:{...d,start:d.start-o,end:d.end-o})}return s},{key:!1,debug:()=>this.options.debug}),this.getVirtualItemForOffset=i=>{var r;let o=this.getMeasurements();if(o.length===0)return;let s=(r=this._singleLaneMeasurements)==null?void 0:r.flat,n=this.options.lanes===1&&s!=null,a=zc(0,o.length-1,n?l=>s[l*2]:l=>nn(o[l]).start,i);return nn(o[a])},this._noteClampMax=()=>{if(!this._awaitingCommandReadBack())return;let i=this._elementMaxScrollOffset();if(i===null)return;let r=this.pendingWrite,o=Math.max(i,0)+this._holdOffset;if(o>=r.target)return;let s=r.lowMaxes??(r.lowMaxes=[]);s[s.length-1]!==o&&s.push(o)},this.getMaxScrollOffset=()=>(this._elementMaxScrollOffset()??0)+this._holdOffset,this._toLayoutOffset=i=>{var r;let o=i+this._holdOffset;return((r=this.pendingScrollAnchor)==null?void 0:r.kind)==="anchor"&&(o+=this.pendingScrollAnchor.delta),o},this._elementMaxScrollOffset=()=>{let i=this.scrollElement;if(i===null)return null;if("scrollHeight"in i)return this.options.horizontal?i.scrollWidth-i.clientWidth:i.scrollHeight-i.clientHeight;if("document"in i){let r=i.document.documentElement;return this.options.horizontal?r.scrollWidth-i.innerWidth:r.scrollHeight-i.innerHeight}return null},this._momentumStop=null,this._stopMomentum=i=>{let r=this.scrollElement,o=this.targetWindow;if(r===null||o===null)return;let s="document"in r?r.document.scrollingElement:r;if(!s?.style)return;if(this._momentumStop){this._momentumStop.done=i;return}let{style:n}=s,a=this.options.horizontal?"overflow-x":"overflow-y",l=n.getPropertyValue(a),d=n.getPropertyPriority(a),h=()=>this.options.horizontal?s.clientHeight:s.clientWidth,p=h();if(n.setProperty(a,"hidden","important"),h()!==p){n.setProperty(a,l,d);return}let x={restore:()=>n.getPropertyValue(a)!=="hidden"||n.getPropertyPriority(a)!=="important"?!1:(n.setProperty(a,l,d),!0),done:i};this._momentumStop=x,o.requestAnimationFrame(()=>o.requestAnimationFrame(()=>{this._momentumStop===x&&(this._momentumStop=null,x.restore()&&x.done())}))},this._clampedBy=i=>{let r=this._elementMaxScrollOffset();if(r===null)return null;let o=r+this._holdOffset;return i>o+.5?{target:i,maxAtWrite:o}:null},this.getVirtualDistanceFromEnd=()=>Math.max(this._getLayoutTotalSize()+this.options.scrollMargin-this.getSize()-this.getScrollOffset(),0),this.getDistanceFromEnd=()=>Math.max(this.getMaxScrollOffset()-this.getScrollOffset(),0),this.isAtEnd=(i=this.options.scrollEndThreshold)=>this.getDistanceFromEnd()<=i,this.getOffsetForAlignment=(i,r,o=0)=>{if(!this.scrollElement)return 0;let s=this.getSize(),n=this.getScrollOffset();r==="auto"&&(r=i>=n+s?"end":"start"),r==="center"?i+=(o-s)/2:r==="end"&&(i-=s);let a=this.getMaxScrollOffset();return Math.max(Math.min(a,i),0)},this.getOffsetForIndex=(i,r="auto")=>{i=Math.max(0,Math.min(i,this.options.count-1));let o=this.getSize(),s=this.getScrollOffset(),n=this.getMeasurements()[i];if(!n)return;if(r==="auto")if(n.end>=s+o-this.options.scrollPaddingEnd)r="end";else if(n.start<=s+this.options.scrollPaddingStart)r="start";else return[s,r];if(r==="end"&&i===this.options.count-1){let l=this.getMaxScrollOffset(),d=l-this.options.paddingEnd+this.options.scrollPaddingEnd;return[Math.max(Math.min(d,l),0),r]}let a=r==="end"?n.end+this.options.scrollPaddingEnd:n.start-this.options.scrollPaddingStart;return[this.getOffsetForAlignment(a,r,n.size),r]},this.scrollToOffset=(i,{align:r="start",behavior:o="auto"}={})=>{this._startScroll({index:null,align:r},this.getOffsetForAlignment(i,r),o,"absolute")},this.scrollToIndex=(i,{align:r="auto",behavior:o="auto"}={})=>{i=Math.max(0,Math.min(i,this.options.count-1));let s=this.getOffsetForIndex(i,r);if(!s)return;let[n,a]=s;this._startScroll({index:i,align:a},n,o,"absolute")},this.scrollBy=(i,{behavior:r="auto"}={})=>{let o=this.getOffsetForAlignment((this.getCommandWrittenOffset()??this.getScrollOffset())+i,"start");this._startScroll({index:null,align:"start"},o,r,"relative")},this.scrollToEnd=({behavior:i="auto"}={})=>{if(this.options.count>0){this._startScroll({index:this.options.count-1,align:"end",toEnd:!0},Math.max(this.getMaxScrollOffset(),0),i,"absolute");return}this.scrollToOffset(Math.max(this.getTotalSize()-this.getSize(),0),{behavior:i})},this.cancelScroll=()=>{this.rafId!=null&&this.targetWindow&&(this.targetWindow.cancelAnimationFrame(this.rafId),this.rafId=null),this.scrollState=null},this.getTotalSize=()=>Math.max(this._getLayoutTotalSize()-this._holdOffset,0),this._getLayoutTotalSize=()=>{var i,r;let o=this.getMeasurements(),s;if(o.length===0)s=this.options.paddingStart;else if(this.options.lanes===1){let n=o.length-1,a=(i=this._singleLaneMeasurements)==null?void 0:i.flat;a!=null?s=a[n*2]+a[n*2+1]:s=((r=o[n])==null?void 0:r.end)??0}else{let n=Array(this.options.lanes).fill(null),a=o.length-1;for(;a>=0&&n.some(l=>l===null);){let l=o[a];n[l.lane]===null&&(n[l.lane]=l.end),a--}s=Math.max(...n.filter(l=>l!==null))}return Math.max(s-this.options.scrollMargin+this.options.paddingEnd,0)},this.takeSnapshot=()=>{let i=[];if(this.itemSizeCache.size===0)return i;let r=this.getMeasurements();for(let o of r)o&&this.itemSizeCache.has(o.key)&&i.push({index:o.index,key:o.key,start:o.start,size:o.size,end:o.end,lane:o.lane});return i},this._scrollToOffset=(i,{adjustments:r,behavior:o}={})=>{let s={target:i+(r??0),smooth:o==="smooth"};return this.pendingWrite=s,this.options.scrollToFn(i-this._holdOffset,{behavior:o,adjustments:r},this),s},this.getCommandWrittenOffset=()=>this.scrollState!==null&&this.pendingWrite!==null&&!this.pendingWrite.smooth?this.pendingWrite.target:null,this._awaitingCommandReadBack=()=>{let i=this.getCommandWrittenOffset();return!(Mr()&&this._iosGesture.dragging())&&i!==null&&!St(i,this.getScrollOffset())},this._followOffsetTarget=i=>{this.scrollState!==null&&this.scrollState.index==null&&(this.scrollState.lastTargetOffset+=i)},this.measure=()=>{this.pendingMin=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),this.itemSizeCacheVersion++,this.notify(!1)},this.setOptions(e)}get scrollAdjustments(){return 0}applyScrollAdjustment(e,i){if(e===0)return!1;if(this._followOffsetTarget(e),this._canWriteScroll()){let r=this.getScrollOffset();this._clampedAdjustment=this._clampedBy(r+e);let o=this._scrollToOffset(r,{adjustments:e,behavior:i});return this.scrollOffset!==null&&(this.pendingWrite===o&&(this.scrollOffset+=e),this.scrollOffset<0&&(this.scrollOffset=0)),!0}else return this._holdOffset+=e,this.scrollOffset!==null&&(this.scrollOffset+=e),!0}scheduleScrollReconcile(){if(!this.targetWindow){this.scrollState=null;return}this.rafId==null&&(this.rafId=this.targetWindow.requestAnimationFrame(()=>{this.rafId=null,this.reconcileScroll()}))}getScrollStateTarget(e){let i=e.toEnd?[Math.max(this.getMaxScrollOffset(),0)]:e.index!=null?this.getOffsetForIndex(e.index,e.align):void 0;return i?i[0]:e.lastTargetOffset}reconcileScroll(){if(!this.scrollState||!this.scrollElement)return;if(this.now()-this.scrollState.startedAt>5e3){this.scrollState=null;return}if(this.scrollState.phase==="queued"){this.scheduleScrollReconcile();return}this.getMeasurements();let r=this.getScrollStateTarget(this.scrollState),o=this.scrollState.index==null?1:this.options.useAnimationFrameWithResizeObserver?3:2,s=r!==this.scrollState.lastTargetOffset;if(!s&&St(r,this.getScrollOffset())){if(this.scrollState.phase==="smooth"?this.scrollState.phase="smoothLanded":this.scrollState.phase==="smoothFinishing"&&(this.scrollState.phase="instant"),this.scrollState.stableFrames++,this.scrollState.stableFrames>=o){this.getScrollOffset()!==r&&this._scrollToOffset(r,{behavior:"auto"}),this.scrollState=null;return}}else if(this.scrollState.stableFrames=0,s){let n=this.getSize()||600,a=Math.abs(r-this.getScrollOffset()),l=Or(this.scrollState)&&a>n;this.scrollState.lastTargetOffset=r,l?this.scrollState.phase="smooth":this.scrollState.phase==="smooth"?this.scrollState.phase="smoothFinishing":this.scrollState.phase==="smoothLanded"&&(this.scrollState.phase="instant"),this._scrollToOffset(r,{behavior:l?"smooth":"auto"})}this.scheduleScrollReconcile()}_startScroll(e,i,r,o){this.pendingScrollAnchor=null,this._clampedAdjustment=null;let s=this._iosGesture.tail();if(o==="absolute"&&s!==null){if(s==="fling"&&vc()){this._stopMomentum(()=>{let n=this.scrollState;n?.phase!=="queued"||this._iosGesture.tail()!=="fling"||this._reportedOverscroll||(this._iosGesture.end(),this._flushHoldIfReady(!0),this._writeAwaitingCommand())}),this.scrollState={...e,startedAt:this.now(),lastTargetOffset:i,stableFrames:0,phase:"queued",behavior:r,samples:[]},this.scheduleScrollReconcile();return}this._iosGesture.end()}this.scrollState={...e,startedAt:this.now(),lastTargetOffset:i,stableFrames:0,behavior:r,phase:xc(r,e.index!=null&&St(i,this.getScrollOffset()))},this._scrollToOffset(i,{behavior:r}),this.scheduleScrollReconcile()}},zc=(t,e,i,r)=>{for(;t<=e;){let o=(t+e)/2|0,s=i(o);if(s<r)t=o+1;else if(s>r)e=o-1;else return o}return t>0?t-1:0};function bm(t,e,i){let r=0;for(;r<=e;){let o=(r+e)/2|0,s=t[o*2];if(s<i)r=o+1;else if(s>i)e=o-1;else return o}return r>0?r-1:0}function ym(t,e,i,r,o){let s=t.length-1;if(t.length<=r)return{startIndex:0,endIndex:s};if(r===1&&o!==null){let d=bm(o,s,i),h=d,p=i+e;for(;h<s&&o[h*2]+o[h*2+1]<p;)h++;return{startIndex:d,endIndex:h}}let a=zc(0,s,d=>t[d].start,i),l=a;if(r===1)for(;l<s&&t[l].end<i+e;)l++;else if(r>1){let d=Array(r).fill(0);for(;l<s&&d.some(p=>p<i+e);){let p=t[l];d[p.lane]=p.end,l++}let h=Array(r).fill(i+e);for(;a>=0&&h.some(p=>p>=i);){let p=t[a];h[p.lane]=p.start,a--}a=Math.max(0,a-a%r),l=Math.min(s,l+(r-1-l%r))}return{startIndex:a,endIndex:l}}var Sc=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},xm=v`
    ${F}

    :host {
        display: inline-grid;

        --_selection-background: var(--color-control-selected-background, #ddeadf);
        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_selection-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_radius-full: 999px;
        --_size-font-md: var(--size-font-md, 14px);
        --_control-size: max(var(--_size-font-md), calc(var(--_target-size) * 0.5));
        --_dot-size: max(8px, calc(var(--_control-size) * 0.5));
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-radio-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-radio-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: calc(var(--_space-inline-sm) * 2);
        align-items: start;
        min-block-size: var(--_target-size);
        cursor: pointer;
    }

    :host([inline]) .root {
        grid-template-columns: auto;
        gap: 0;
        align-items: center;
        min-block-size: auto;
    }

    .control-shell {
        position: relative;
        display: inline-grid;
        min-block-size: var(--_target-size);
        align-items: center;
    }

    :host([inline]) .control-shell {
        min-block-size: auto;
        line-height: 0;
    }

    .control {
        box-sizing: border-box;
        position: relative;
        display: inline-grid;
        place-items: center;
        inline-size: var(--_control-size);
        block-size: var(--_control-size);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-full);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .dot {
        position: absolute;
        inset-inline-start: 50%;
        inset-block-start: 50%;
        inline-size: var(--_dot-size);
        block-size: var(--_dot-size);
        border-radius: var(--_radius-full);
        background: var(--_selection-text);
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.72);
        transform-origin: center;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([checked]) .control {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    :host([checked]) .dot {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }

    :host(:focus-visible) .control {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .control {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host([aria-disabled="true"]) .root {
        cursor: not-allowed;
    }

    /* Supporting text often says why the control is unavailable, so it stays readable. */
    :host([disabled]) :is(.control-shell, .label),
    :host([aria-disabled="true"]) :is(.control-shell, .label) {
        opacity: 0.6;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_target-size);
        align-content: center;
        min-inline-size: 0;
    }

    .content[hidden] {
        display: none;
    }

    :host([inline]) .content {
        min-block-size: auto;
        align-content: center;
    }

    .label {
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .supporting {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    @media (forced-colors: active) {
        .control {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        :host([checked]) .control {
            border-color: Highlight;
        }

        .dot {
            forced-color-adjust: none;
            background: Highlight;
        }

        :host(:focus-visible) .control {
            outline: 2px solid Highlight;
            outline-offset: 2px;
        }

        :host([disabled]) .control,
        :host([aria-disabled="true"]) .control {
            border-color: GrayText;
        }

        :host([disabled]) .dot,
        :host([aria-disabled="true"]) .dot {
            background: GrayText;
        }
    }
`,wm=u`
    <div class="root" part="root" @click="${(t,e)=>t.handleClick(e.event)}">
        <span class="control-shell">
            <span class="control" part="control" aria-hidden="true">
                <span class="dot" part="mark"></span>
            </span>
        </span>
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting}">
            <span class="label" part="label" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </span>
            <span class="supporting" part="supporting-text" ?hidden="${t=>!t.hasSupporting}">
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
        </span>
    </div>
`,Ge=class extends f{#e;#t;#i;constructor(){super(),this.handleKeydown=e=>{e.defaultPrevented||e.key!==" "&&e.key!=="Enter"||this.closest("violet-radio-group")||(e.preventDefault(),this.#r())},this.#e=this.attachInternals(),this.#e.role="radio",this.#t=null,this.#i=!1,this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.name="",this.value="on"}connectedCallback(){super.connectedCallback(),this.setAttribute("role","radio"),this.addEventListener("keydown",this.handleKeydown),this.#n(),this.#s(),this.#a(),this.#l()}disconnectedCallback(){this.removeEventListener("keydown",this.handleKeydown),super.disconnectedCallback()}get effectiveDisabled(){return this.disabled||this.#i}setCheckedFromGroup(e){this.checked=e}setGroupDisabled(e){this.#i=e,this.#a(),this.#l()}setManagedTabIndex(e){this.#t=e,this.#l()}handleClick(e){e.preventDefault(),this.#r()}handleDefaultSlotChange(){this.#n(),this.#a()}handleSupportingSlotChange(){this.#s()}checkedChanged(){this.#a(),this.#l()}disabledChanged(){this.#a(),this.#l()}invalidChanged(){this.#a()}valueChanged(){this.#a()}get controlAriaLabel(){let e=this.getAttribute("aria-label");return e||this.#o()||null}#r(){this.effectiveDisabled||(this.focus(),!this.checked&&(this.checked=!0,this.$emit("change",{checked:!0,value:this.value})))}#n(){this.hasLabel=this.#o().length>0}#s(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#o(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#a(){this.#e.ariaChecked=this.checked?"true":"false",this.#e.ariaDisabled=this.effectiveDisabled?"true":"false",this.#e.ariaInvalid=this.invalid?"true":"false";let e=this.shadowRoot?.querySelector(".label:not([hidden])"),i=this.shadowRoot?.querySelector(".supporting:not([hidden])");e instanceof Element?(this.#e.ariaLabelledByElements=[e],this.#e.ariaLabel=null):(this.#e.ariaLabelledByElements=null,this.#e.ariaLabel=this.controlAriaLabel??null),this.#e.ariaDescribedByElements=i instanceof Element?[i]:null,this.$fastController.isConnected&&this.setAttribute("aria-checked",this.checked?"true":"false"),this.effectiveDisabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled")}#l(){if(this.$fastController.isConnected){if(this.effectiveDisabled){this.tabIndex=-1;return}this.tabIndex=this.#t??0}}};Sc([m],Ge.prototype,"hasSupporting",void 0);Sc([m],Ge.prototype,"hasLabel",void 0);c({mode:"boolean"})(Ge.prototype,"checked");c({mode:"boolean"})(Ge.prototype,"disabled");c({mode:"boolean"})(Ge.prototype,"inline");c({mode:"boolean"})(Ge.prototype,"invalid");c(Ge.prototype,"name");c(Ge.prototype,"value");customElements.get("violet-radio")||await f.define(Ge,{name:"violet-radio",template:wm,styles:xm});var _m=v`
    ${F}

    :host {
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        inline-size: 100%;
        block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: 0;
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        font-family: inherit;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: var(--color-text-primary, #18181b);
        box-shadow: none;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
    }

    .control::placeholder {
        color: var(--_text-muted);
    }

    .control:focus {
        outline: none;
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([readonly]) .control-frame {
        background: var(--_surface-subtle);
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([disabled]) .control,
    :host(:disabled) .control {
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    slot[name="before"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        color: var(--_text-muted);
    }

    ::slotted([slot="before"]) {
        margin-inline-end: var(--_space-inline-sm);
    }

    .supporting {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`,km=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>
            `)}
        <div class="control-frame" part="control-frame">
            <slot name="before" part="before"></slot>
            <input
                id="${t=>t.inputId}"
                class="control"
                part="control"
                name="${t=>t.name}"
                type="${t=>t.type}"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.step}"
                minlength="${t=>t.minLength}"
                maxlength="${t=>t.maxLength}"
                pattern="${t=>t.pattern||null}"
                autocomplete="${t=>t.autocomplete}"
                inputmode="${t=>t.inputMode||null}"
                placeholder="${t=>t.placeholder}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?readonly="${t=>t.readonly}"
                ?required="${t=>t.required}"
                aria-label="${t=>t.label||t.getAttribute("aria-label")||""}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
    </div>
`,$c=0,Q=class extends f{static{this.formAssociated=!0}#e;#t=new MutationObserver(()=>this.#o());#i=()=>this.#a();#r=!1;#n;constructor(){super(),this.#e=this.attachInternals(),$c+=1,this.inputId=`violet-text-field-${$c}`,this.supportingId=`${this.inputId}-supporting`,this.label="",this.placeholder="",this.value="",this.type="text",this.supportingText="",this.disabled=!1,this.readonly=!1,this.invalid=!1,this.name="",this.required=!1,this.#n=""}connectedCallback(){super.connectedCallback(),this.#s(),this.#n=this.getAttribute("value")??this.value,this.#l(),this.#a(),this.#t.observe(this,{attributes:!0,attributeFilter:["aria-describedby"]}),this.addEventListener("focusin",this.#i),this.#o()}disconnectedCallback(){super.disconnectedCallback(),this.#t.disconnect(),this.removeEventListener("focusin",this.#i)}handleInput(e){let i=e.currentTarget;this.value=i?.value??"",this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#n,this.#s(!0)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}valueChanged(){this.#s(),this.#l(),this.#o()}#s(e=!1){let i=this.shadowRoot?.querySelector("input.control");i&&(e||i.value!==this.value)&&(i.value=this.value)}typeChanged(){this.#o()}minChanged(){this.#o()}maxChanged(){this.#o()}stepChanged(){this.#o()}minLengthChanged(){this.#o()}maxLengthChanged(){this.#o()}patternChanged(){this.#o()}supportingTextChanged(){this.#o()}disabledChanged(){this.#l()}invalidChanged(){this.#l()}readonlyChanged(){this.#l()}requiredChanged(){this.#l(),this.#o()}#o(){this.#r||!this.$fastController.isConnected||(this.#r=!0,K.enqueue(()=>{K.enqueue(()=>{this.#r=!1,this.#l(),this.#a()})}))}#a(){let e=this.shadowRoot?.querySelector("input");if(!e)return;let i=[],r=this.getRootNode(),o=(this.getAttribute("aria-describedby")??"").split(/\s+/).filter(Boolean);for(let a of o){let l=r.getElementById?.(a)??null;l&&!i.includes(l)&&i.push(l)}let s=this.shadowRoot?.getElementById(this.supportingId)??null;if(s&&i.push(s),"ariaDescribedByElements"in e){e.removeAttribute("aria-describedby"),e.ariaDescribedByElements=i.length?i:null;return}s?e.setAttribute("aria-describedby",this.supportingId):e.removeAttribute("aria-describedby")}#l(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector("input");if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:this.value),this.effectiveDisabled||this.readonly){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},"Please correct this field.",e??void 0);return}if(this.required&&!this.value.trim()){this.#e.setValidity({valueMissing:!0},"Please fill out this field.",e??void 0);return}if(!e){this.#e.setValidity({});return}let i=e.validity,r=this.value.length,o=i.tooShort||this.minLength!=null&&r>0&&r<this.minLength,s=i.tooLong||this.maxLength!=null&&r>this.maxLength;if(i.valid&&!o&&!s){this.#e.setValidity({});return}let n=e.validationMessage;!n&&o?n=`Please lengthen this text to ${this.minLength} characters or more.`:!n&&s&&(n=`Please shorten this text to ${this.maxLength} characters or less.`),this.#e.setValidity({valueMissing:i.valueMissing,typeMismatch:i.typeMismatch,patternMismatch:i.patternMismatch,tooLong:s,tooShort:o,rangeUnderflow:i.rangeUnderflow,rangeOverflow:i.rangeOverflow,stepMismatch:i.stepMismatch,badInput:i.badInput,customError:i.customError},n,e)}};c(Q.prototype,"label");c(Q.prototype,"placeholder");c({mode:"fromView"})(Q.prototype,"value");c(Q.prototype,"type");c(Q.prototype,"min");c(Q.prototype,"max");c(Q.prototype,"step");c({attribute:"minlength",converter:to})(Q.prototype,"minLength");c({attribute:"maxlength",converter:to})(Q.prototype,"maxLength");c(Q.prototype,"pattern");c(Q.prototype,"autocomplete");c({attribute:"inputmode"})(Q.prototype,"inputMode");c({attribute:"supporting-text"})(Q.prototype,"supportingText");c({mode:"boolean"})(Q.prototype,"disabled");q(Q.prototype);c({mode:"boolean"})(Q.prototype,"readonly");c({mode:"boolean"})(Q.prototype,"invalid");c(Q.prototype,"name");c({mode:"boolean"})(Q.prototype,"required");customElements.get("violet-text-field")||await f.define(Q,{name:"violet-text-field",template:km,styles:_m,shadowOptions:{delegatesFocus:!0}});var Ec=v`
    :host {
        display: block;
        container-type: inline-size;
        color: var(--color-text-primary, #18181b);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_surface-selected: var(--color-surface-selected, #ddeadf);
        --_control-selected-background: var(--color-control-selected-background, #ddeadf);
        --_control-selected-foreground: var(--color-control-selected-foreground, #244635);
        --_control-selected-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_error-background: var(--color-state-danger-background, #fbe2e2);
        --_error-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_error-text: var(--color-state-danger-text, #b42318);
        --_active-cell-ring: var(--violet-data-grid-active-cell-ring, color-mix(in srgb, var(--_focus-ring) 82%, transparent));
        --_active-cell-ring-width: var(--violet-data-grid-active-cell-ring-width, var(--size-focus-ring-width, 2px));
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-card: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
        /* Stacking layers. Declared here rather than inherited: an undefined
           custom property makes the z-index declaration invalid at
           computed-value time, so it is dropped and the element falls back to
           z-index auto — a sticky header then scrolls behind the rows instead
           of above them. Values match violet-token-defaults. */
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_focus-outline-offset: 2px;
        --_type-meta-size: 0.875rem;
        --_type-cell-size: 0.9375rem;
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_row-target-size: var(--_target-size-natural);
        --_column-resizer-target-size: var(--_target-size-compact);
        --_filter-max-inline: min(24rem, 100%);
        --_toolbar-primary-column: 20rem;
        --_selection-column-size: 3.25rem;
        --_selection-control-size: 1rem;
        --_loading-min-block-size: 10rem;
        --_overlay-blur: 4px;
        --_visually-hidden-size: 1px;
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline, 0.875rem);
        --_virtualized-max-block-size: var(--violet-data-grid-virtualized-max-block-size, 32rem);
    }

    :host([density="compact"]) {
        --_row-target-size: var(--_target-size-compact);
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline-compact, 0.875rem);
    }

    :host([density="comfortable"]) {
        --_row-target-size: var(--_target-size-comfortable);
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline-comfortable, 1rem);
    }

    :host(:focus-visible) {
        outline: 2px solid var(--_focus-ring);
        outline-offset: var(--_focus-outline-offset);
    }

    :host([busy]) .table-scroll {
        cursor: progress;
    }

    .grid-shell {
        display: grid;
        gap: var(--_space-stack-sm);
        min-inline-size: 0;
        min-block-size: 0;
        block-size: 100%;
    }

    .toolbar {
        display: grid;
        gap: var(--_space-inline-sm);
        align-items: start;
    }

    .toolbar-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--_space-inline-sm);
        color: var(--_text-secondary);
        font-size: var(--_type-meta-size);
    }

    .toolbar-slot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-inline-sm);
    }

    .filter-shell {
        display: grid;
        max-inline-size: var(--_filter-max-inline);
    }

    .filter-field {
        inline-size: 100%;
    }

    .table-region {
        position: relative;
        min-inline-size: 0;
        min-block-size: 0;
    }

    .edit-status {
        position: absolute;
        z-index: var(--_layer-sticky);
        inset-block-start: var(--_space-stack-xs);
        inset-inline-end: var(--_space-inline-sm);
        max-inline-size: min(24rem, calc(100% - (var(--_space-inline-sm) * 2)));
        padding: var(--_space-stack-xs) var(--_space-inline-sm);
        border: 1px solid var(--_error-border);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_error-background);
        color: var(--_error-text);
        box-shadow: var(--_shadow-card);
        font-size: 0.8125rem;
        line-height: 1.35;
        pointer-events: none;
    }

    .edit-status:empty {
        display: none;
    }

    .table-scroll {
        box-sizing: border-box;
        max-inline-size: 100%;
        min-inline-size: 0;
        overflow: auto;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-card);
        scrollbar-color: color-mix(in srgb, var(--_border-strong) 65%, transparent) transparent;
        outline: none;
    }

    .table-scroll:focus-visible {
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    :host([virtualize]) .table-scroll {
        block-size: 100%;
        max-block-size: var(--_virtualized-max-block-size);
        overflow-anchor: none;
    }

    .table-canvas {
        min-inline-size: 100%;
        overflow: visible;
    }

    :host([virtualize]) .table-canvas {
        min-block-size: calc(var(--_virtual-total-size, 0px) + var(--_row-target-size));
    }

    .table-scroll::-webkit-scrollbar {
        inline-size: 0.625rem;
        block-size: 0.625rem;
    }

    .table-scroll::-webkit-scrollbar-track {
        background: transparent;
    }

    .table-scroll::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--_border-strong) 72%, transparent);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
    }

    .table-scroll::-webkit-scrollbar-corner {
        background: transparent;
    }

    .table-full-table {
        min-inline-size: 100%;
        inline-size: max-content;
        border-collapse: separate;
        border-spacing: 0;
        table-layout: fixed;
    }

    thead {
        background: var(--_surface-subtle);
    }

    :host([sticky-header]) .table-full-table thead th {
        position: sticky;
        inset-block-start: 0;
        z-index: var(--_layer-raised);
        background: var(--_surface-subtle);
    }

    th,
    td {
        box-sizing: border-box;
        block-size: var(--_row-target-size);
        border-block-end: 1px solid var(--_border-subtle);
        padding-inline: var(--_row-padding-inline);
        padding-block: 0;
        text-align: start;
        vertical-align: middle;
    }

    tbody tr:last-of-type td {
        border-block-end: none;
    }

    .virtual-spacer-row,
    .virtual-spacer-row td {
        padding: 0;
        border: 0;
        background: transparent;
        overflow-anchor: none;
    }

    .virtual-spacer-row td {
        min-block-size: 0;
    }

    th {
        color: var(--_text-secondary);
        font-size: var(--_type-meta-size);
        font-weight: 600;
        position: relative;
    }

    th[data-column-id] {
        padding-inline-end: var(--_column-resizer-target-size);
    }

    th:not(:last-child),
    td:not(:last-child) {
        border-inline-end: 1px solid var(--_border-subtle);
    }

    .header-button {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: 100%;
        padding: 0;
        padding-inline-end: calc(var(--_space-inline-sm) + 0.5rem);
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: inherit;
        cursor: pointer;
    }

    .header-button:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: var(--_focus-outline-offset);
        border-radius: calc(var(--_radius-md) / 2);
    }

    th[tabindex]:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: -2px;
    }

    .header-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sort-indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        color: var(--_text-muted);
        flex: 0 0 auto;
        transition:
            opacity 120ms ease,
            color 120ms ease;
    }

    .sort-indicator[data-sorted="false"] {
        opacity: 0;
        color: color-mix(in srgb, var(--_text-muted) 72%, var(--_surface-card));
    }

    th:hover .sort-indicator[data-sorted="false"],
    .header-button:hover .sort-indicator[data-sorted="false"],
    .header-button:focus-visible .sort-indicator[data-sorted="false"] {
        opacity: 1;
    }

    .column-resizer {
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
        box-sizing: border-box;
        inline-size: var(--_column-resizer-target-size);
        padding: 0;
        border: none;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
        z-index: var(--_layer-sticky);
    }

    .column-resizer::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
        inline-size: 1px;
        background: color-mix(in srgb, var(--_border-strong) 58%, transparent);
        opacity: 0;
        transition: opacity 120ms ease;
    }

    th:hover .column-resizer::before,
    .column-resizer:focus-visible::before {
        opacity: 1;
    }

    .column-resizer:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 1px;
        border-radius: 999px;
    }

    td {
        background: var(--_surface-page);
        color: var(--_text-primary);
        font-size: var(--_type-cell-size);
        position: relative;
        user-select: text;
        -webkit-user-select: text;
    }

    :host([focus-mode="cell"]) td {
        user-select: none;
        -webkit-user-select: none;
    }

    td[data-selected="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 48%, var(--_surface-page));
    }

    td[data-fill-preview="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 62%, var(--_surface-page));
    }

    td[data-active="true"]::after {
        content: "";
        position: absolute;
        inset: calc(-1 * var(--_active-cell-ring-width));
        pointer-events: none;
        z-index: var(--_layer-raised);
        border: var(--_active-cell-ring-width) solid var(--_active-cell-ring);
        box-sizing: border-box;
    }

    td[data-active="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 70%, var(--_surface-page));
    }

    .fill-handle {
        position: absolute;
        inset-inline-end: -3px;
        inset-block-end: -3px;
        inline-size: 6px;
        block-size: 6px;
        border: 1px solid var(--_active-cell-ring);
        border-radius: 2px;
        background: var(--_surface-card);
        cursor: crosshair;
        box-shadow: 0 0 0 1px var(--_surface-card);
        z-index: var(--_layer-sticky);
    }

    .cell-content {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .cell-widget {
        display: inline-grid;
        align-items: center;
        justify-items: start;
        inline-size: 100%;
        min-inline-size: 0;
    }

    .cell-sizing-content {
        display: block;
        visibility: hidden;
        pointer-events: none;
    }

    .cell-widget[data-align="center"] {
        justify-items: center;
    }

    .cell-checkbox {
        display: inline-grid;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        --violet-checkbox-inline-target-size: var(--_selection-control-size);
    }

    .cell-radio {
        display: inline-grid;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        --violet-radio-inline-target-size: var(--_selection-control-size);
        --violet-radio-inline-gap: 0;
    }

    .cell-editor {
        position: absolute;
        inset-inline-start: var(--_row-padding-inline);
        inset-inline-end: var(--_row-padding-inline);
        inset-block-start: 50%;
        transform: translateY(-50%);
        display: block;
        box-sizing: border-box;
        inline-size: auto;
        min-inline-size: 0;
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        padding: 0;
        border: none;
        background: transparent;
        color: var(--_text-primary);
        font: inherit;
        line-height: inherit;
        text-align: inherit;
        outline: none;
        appearance: none;
    }

    violet-data-grid-pill-select.cell-editor {
        inset-inline-start: var(--_row-padding-inline);
        inset-inline-end: auto;
        inset-block-start: 50%;
        transform: translateY(-50%);
        display: inline-grid;
        inline-size: fit-content;
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        justify-self: start;
        z-index: var(--_layer-raised);
    }

    input.cell-editor[type="number"] {
        appearance: textfield;
        -moz-appearance: textfield;
    }

    input.cell-editor[type="number"]::-webkit-outer-spin-button,
    input.cell-editor[type="number"]::-webkit-inner-spin-button {
        margin: 0;
        -webkit-appearance: none;
    }

    .cell-editor:focus {
        outline: none;
    }

    .cell-editor-hint {
        position: absolute;
        /* Above the fill handle, which shares the sticky layer. */
        z-index: calc(var(--_layer-sticky) + 1);
        inset-inline-start: var(--_row-padding-inline);
        inset-block-start: calc(100% - var(--_space-stack-xs));
        /* A sentence rather than a word: wider than the edit error, still bounded. */
        inline-size: max-content;
        max-inline-size: 18rem;
        padding: 2px var(--_space-stack-xs);
        border: 1px solid var(--_border-strong);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_surface-floating);
        color: var(--_text-primary);
        box-shadow: var(--_shadow-card);
        font-size: 0.75rem;
        line-height: 1.25;
        white-space: normal;
    }

    .cell-editor-error {
        position: absolute;
        z-index: var(--_layer-sticky);
        inset-inline-start: var(--_row-padding-inline);
        inset-block-start: calc(100% - var(--_space-stack-xs));
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        padding: 2px var(--_space-stack-xs);
        border: 1px solid var(--_error-border);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_error-background);
        color: var(--_error-text);
        box-shadow: var(--_shadow-card);
        font-size: 0.75rem;
        line-height: 1.25;
        white-space: normal;
    }

    .selection-cell,
    .selection-header {
        inline-size: var(--_selection-column-size);
        padding-inline: 0;
        line-height: 0;
        text-align: center;
    }

    .selection-control {
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        accent-color: var(--_control-selected-foreground);
        user-select: auto;
        -webkit-user-select: auto;
    }

    .selection-checkbox {
        display: block;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        justify-self: center;
        --violet-checkbox-inline-target-size: var(--_selection-control-size);
        user-select: auto;
        -webkit-user-select: auto;
    }

    .selection-radio {
        display: block;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        justify-self: center;
        --violet-radio-inline-target-size: var(--_selection-control-size);
        --violet-radio-inline-gap: 0;
        user-select: auto;
        -webkit-user-select: auto;
    }

    tbody tr[data-selected="true"] {
        background: var(--_surface-selected);
    }

    tbody tr[data-selected="true"] td {
        color: var(--_text-primary);
    }

    .loading-state,
    .empty-state {
        display: grid;
        place-items: center;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_loading-min-block-size);
        padding: calc(var(--_row-padding-inline) * 1.5);
        text-align: center;
        color: var(--_text-secondary);
        background: var(--_surface-card);
    }

    .loading-overlay {
        position: absolute;
        inset: 1px;
        display: grid;
        place-items: center;
        padding: var(--_space-inline-md);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--violet-data-grid-loading-overlay-background, rgba(250, 249, 245, 0.58));
        color: var(--_text-secondary);
        backdrop-filter: blur(calc(var(--_overlay-blur) * 1.75));
        -webkit-backdrop-filter: blur(calc(var(--_overlay-blur) * 1.75));
    }

    .default-slot {
        display: contents;
    }

    .visually-hidden {
        position: absolute;
        inline-size: var(--_visually-hidden-size);
        block-size: var(--_visually-hidden-size);
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    th[data-align="center"],
    td[data-align="center"] {
        text-align: center;
    }

    th[data-align="end"],
    td[data-align="end"] {
        text-align: end;
    }

    @container (min-width: 48rem) {
        .toolbar {
            grid-template-columns: minmax(0, var(--_toolbar-primary-column)) minmax(0, 1fr);
            align-items: end;
        }

        .toolbar-meta {
            justify-content: flex-end;
        }
    }
`;function Tc(t,e){return!t||!e?!1:e.rowIndex>=t.rowStart&&e.rowIndex<=t.rowEnd&&e.columnIndex>=t.columnStart&&e.columnIndex<=t.columnEnd}function Ic(t,e){if(!t||!e)return"";let i=[];return e.rowIndex===t.rowStart&&i.push("top"),e.rowIndex===t.rowEnd&&i.push("bottom"),e.columnIndex===t.columnStart&&i.push("left"),e.columnIndex===t.columnEnd&&i.push("right"),i.join(" ")}function Ac(t,e,i){return!t||!i||!(i.rowIndex>=t.rowStart&&i.rowIndex<=t.rowEnd&&i.columnIndex>=t.columnStart&&i.columnIndex<=t.columnEnd)?!1:e?!(i.rowIndex>=e.rowStart&&i.rowIndex<=e.rowEnd&&i.columnIndex>=e.columnStart&&i.columnIndex<=e.columnEnd):!0}function Rc(t,e){let i=[t];return e.selected&&(i.push("selected-cell"),e.rangeEdge&&i.push("selected-range-edge")),e.fillPreview&&i.push("fill-preview-cell"),e.active&&i.push("active-cell"),e.editing&&i.push("editing-cell"),i.join(" ")}var Oi=u`
    <span class="cell-content">${t=>t.text}</span>
`,Fc=u`
    <input
        class="cell-editor"
        data-cell-editor="${t=>t.editor}"
        data-row-id="${t=>t.rowId}"
        data-column-id="${t=>t.columnId}"
        aria-label="${t=>`Edit ${t.columnLabel} for ${t.rowLabel}`}"
        aria-invalid="${t=>t.editingError?"true":"false"}"
        aria-errormessage="${t=>t.editingError?t.editingErrorId:null}"
        aria-describedby="${t=>t.editingHint?t.editingHintId:null}"
        inputmode="${t=>t.editor==="number"?"decimal":null}"
        type="text"
    />
`,Dc=u`
    <select
        class="cell-editor"
        data-cell-editor="select"
        data-row-id="${t=>t.rowId}"
        data-column-id="${t=>t.columnId}"
        aria-label="${t=>`Edit ${t.columnLabel} for ${t.rowLabel}`}"
        aria-invalid="${t=>t.editingError?"true":"false"}"
        aria-errormessage="${t=>t.editingError?t.editingErrorId:null}"
        aria-describedby="${t=>t.editingHint?t.editingHintId:null}"
        :value="${t=>t.editValue}"
    >
        ${L(t=>t.editorOptions,u`
                <option value="${t=>t.value}">${t=>t.label}</option>
            `)}
    </select>
`;function Oc(t){if(t.length<=150)return t;let e=t.slice(0,100),i=t.length-100,r=Math.max(1,Math.floor(i/50));for(let s=100;s<t.length&&e.length<150;s+=r){let n=t[s];n&&e.push(n)}let o=t[t.length-1];return o&&!e.includes(o)&&e.push(o),e}function Mc(t){return/[\t\r\n"]/.test(t)?`"${t.replace(/"/g,'""')}"`:t}function Lc(t){let e=[],i=[],r="",o=0,s=!0;for(;o<t.length;){let n=t[o];if(s&&n==='"'){for(o+=1;o<t.length;){if(t[o]==='"'){if(t[o+1]==='"'){r+='"',o+=2;continue}o+=1;break}r+=t[o],o+=1}s=!1;continue}n==="	"?(i.push(r),r="",s=!0):n===`
`?(i.push(r),e.push(i),i=[],r="",s=!0):(r+=n,s=!1),o+=1}return i.push(r),e.push(i),e}function Vc(t){let{selection:e,locations:i,rows:r,columns:o,getCellText:s}=t;if(!i.length)return"";if(!e)return Mc(s(i[0]));let n=[];for(let a=e.rowStart;a<=e.rowEnd;a+=1){let l=[];for(let d=e.columnStart;d<=e.columnEnd;d+=1){let h=r[a],p=o[d];!h||!p||l.push(Mc(s({rowId:h.id,columnId:p.id})))}n.push(l.join("	"))}return n.join(`
`)}function Pc(t){let e=t.replace(/\r\n/g,`
`).replace(/\r/g,`
`);return e.endsWith(`
`)?e.slice(0,-1):e}function Bc(t){let{selection:e,rows:i,columns:r,activeCell:o}=t;if(!e)return o;let s=i[e.rowStart],n=r[e.columnStart];return!s||!n?o:{rowId:s.id,columnId:n.id}}function To(t,e){return e.render?.(t.data)??e.value?.(t.data)??(e.id in Object(t.data)?t.data[e.id]:void 0)}function Nc(t,e){return t.editorOptions?typeof t.editorOptions=="function"?t.editorOptions(e):t.editorOptions:[]}function jc(t){return Number.isNaN(t.getTime())?"":t.toISOString()}function cn(t){if(t==null)return"";if(typeof t=="string")return t;if(typeof t=="number"||typeof t=="boolean"||typeof t=="bigint")return String(t);if(t instanceof Date)return jc(t);if(typeof Node<"u"&&t instanceof Node)return t.textContent??"";if(Array.isArray(t))return t.map(e=>cn(e)).join(", ");try{return JSON.stringify(t)}catch{return String(t)}}function Io(t){return t==null?"":typeof t=="string"||typeof t=="number"||typeof t=="boolean"||typeof t=="bigint"?String(t):t instanceof Date?jc(t):Array.isArray(t)?t.map(e=>cn(e)).join(", "):cn(t)}function Hc(t){return t.column.serialize?t.column.serialize(t.rawValue,t.rowData):t.column.editor==="checkbox"?t.booleanCellValue(t.rawValue)?"true":"false":Io(t.rawValue)}function qc(t){let e=t.rows??[];if(!t.sort||t.sortMode==="external")return[...e];let i=t.columns.find(a=>a.id===t.sort?.columnId);if(!i?.sortable)return[...e];let r=t.sort.direction==="ascending"?1:-1,o=t.getSortKey??((a,l)=>Io(To(a,l))),s=new Intl.Collator(void 0,{numeric:!0,sensitivity:"base"}),n=e.map(a=>({row:a,key:o(a,i)}));return n.sort((a,l)=>s.compare(a.key,l.key)*r),n.map(a=>a.row)}function Wc(t,e,i){return!e?.editable||e.editor==="checkbox"?null:{editingCell:t,editingValue:i}}function Uc(t){return{nextState:Cm(),cancelledCell:t}}function Cm(){return{editingCell:null,editingValue:""}}function Kc(t){return typeof t?.value=="string"?t.value:""}function dn(t,e){let i=t;i&&(i.value=e)}function Gc(t){if(t?.focus?.({preventScroll:!0}),t instanceof HTMLTextAreaElement){let i=t.value.length;t.setSelectionRange(i,i);return}if(t instanceof HTMLInputElement){let i=t.value.length;try{t.setSelectionRange(i,i)}catch{}}}function zm(t){let e=typeof t.composedPath=="function"?t.composedPath():[],i=[],r=new Set,o=s=>{r.has(s)||(r.add(s),i.push(s))};for(let s of e){if(s instanceof HTMLElement){o(s);continue}s instanceof Node&&s.parentElement instanceof HTMLElement&&o(s.parentElement)}return i}function un(t,e){for(let i of zm(t)){let r=i.closest(e);if(r instanceof HTMLElement)return r}return null}function Yc(t){let e=t instanceof HTMLElement?t:t instanceof Node?t.parentElement:null;return e?e.closest("td[data-row-id][data-column-id]"):null}function Xc(t){return un(t,"td[data-row-id][data-column-id]")}function Sm(t,e,i){let r=t.find(s=>s.id===i.rowId),o=e.findIndex(s=>s.id===i.columnId);return!r||o<0?null:r.cells[o]??null}function Jc(t,e){if(!e)return!1;for(let i=e.rowStart;i<=e.rowEnd;i+=1){let r=t[i];if(r){for(let o=e.columnStart;o<=e.columnEnd;o+=1)if(r.cells[o]?.editable)return!0}}return!1}function Ao(t,e,i,r,o){for(let s=e;s<=i;s+=1){let n=t[s];if(!n)return!1;for(let a=r;a<=o;a+=1)if(!n.cells[a]?.editable)return!1}return!0}function Zc(t,e,i){let r={...i};for(let o=i.rowStart-1;o>=e.rowStart&&Ao(t,o,o,r.columnStart,r.columnEnd);o-=1)r.rowStart=o;for(let o=i.rowEnd+1;o<=e.rowEnd&&Ao(t,o,o,r.columnStart,r.columnEnd);o+=1)r.rowEnd=o;for(let o=i.columnStart-1;o>=e.columnStart&&Ao(t,r.rowStart,r.rowEnd,o,o);o-=1)r.columnStart=o;for(let o=i.columnEnd+1;o<=e.columnEnd&&Ao(t,r.rowStart,r.rowEnd,o,o);o+=1)r.columnEnd=o;return r}function ed(t){let{text:e,originIndices:i,selection:r,selectedLocations:o,rows:s,columns:n,normalizeValue:a}=t,l=Lc(e),d=l.length===1&&(l[0]?.length??0)===1;if(r&&d)return o.flatMap(p=>{let x=Sm(s,n,p);return x?.editable?[{rowId:p.rowId,columnId:p.columnId,value:a(x,l[0]?.[0]??"")}]:[]});let h=[];for(let p=0;p<l.length;p+=1){let x=l[p]??[],k=s[i.rowIndex+p];if(!k)break;for(let S=0;S<x.length;S+=1){let A=n[i.columnIndex+S],D=k.cells[i.columnIndex+S];if(!A||!D)break;D.editable&&h.push({rowId:k.id,columnId:A.id,value:a(D,x[S]??"")})}}return h}function Qc(t,e){return(t%e+e)%e}function td(t){let{rows:e,columns:i,sourceBounds:r,targetBounds:o,normalizeValue:s}=t,n=r.rowEnd-r.rowStart+1,a=r.columnEnd-r.columnStart+1,l=[];for(let d=o.rowStart;d<=o.rowEnd;d+=1)for(let h=o.columnStart;h<=o.columnEnd;h+=1){if(d>=r.rowStart&&d<=r.rowEnd&&h>=r.columnStart&&h<=r.columnEnd)continue;let x=e[d],k=i[h],S=x?.cells[h];if(!x||!k||!S?.editable)continue;let A=r.rowStart+Qc(d-r.rowStart,n),D=r.columnStart+Qc(h-r.columnStart,a),_=e[A]?.cells[D];if(!_)continue;let T=_.rawValue??_.text;l.push({rowId:x.id,columnId:k.id,value:S.editor==="number"?s(S,String(T??"")):T})}return l}function Ro(t){let e=t.dataset.rowId,i=t.dataset.columnId;return!e||!i?null:{rowId:e,columnId:i}}function id(t){let{cells:e,clientX:i,clientY:r,predicate:o}=t;if(!e.length)return null;let s=null,n=Number.POSITIVE_INFINITY;for(let a of e){let l=Ro(a);if(!l||o&&!o(l))continue;let d=a.getBoundingClientRect(),h=Math.min(Math.max(i,d.left),d.right),p=Math.min(Math.max(r,d.top),d.bottom),x=Math.hypot(i-h,r-p);x<n&&(n=x,s=a)}return s?Ro(s):null}function rd(t,e,i){if(!i)return null;let r=t<i.left?i.left-t:t>i.right?t-i.right:0,o=e<i.top?i.top-e:e>i.bottom?e-i.bottom:0;return r===0&&o===0?null:r>=o?"horizontal":"vertical"}function od(t,e){if(!t||!e)return null;let i=t.getBoundingClientRect(),r=e.getBoundingClientRect();return new DOMRect(Math.min(i.left,r.left),Math.min(i.top,r.top),Math.max(i.right,r.right)-Math.min(i.left,r.left),Math.max(i.bottom,r.bottom)-Math.min(i.top,r.top))}function Lr(t,e){let i=t[0]?.id,r=e[0]?.id;return!i||!r?null:{rowId:i,columnId:r}}function sd(t,e){return t.rowId===e.rowId&&t.columnId===e.columnId?null:{anchor:t,focus:e}}function nd(t){let e=Lr(t.rows,t.columns),i=t.activeCell??e;if(!i||!t.rows.length||!t.columns.length)return null;let r=t.rows.findIndex(d=>d.id===i.rowId),o=t.columns.findIndex(d=>d.id===i.columnId);if(r<0||o<0)return e;let s=t.rows.length-1,n=t.columns.length-1,a=r,l=o;switch(t.key){case"ArrowUp":a=Math.max(0,r-1);break;case"ArrowDown":a=Math.min(s,r+1);break;case"ArrowLeft":l=Math.max(0,o-1);break;case"ArrowRight":l=Math.min(n,o+1);break;case"Home":t.metaKey&&(a=0),l=0;break;case"End":t.metaKey&&(a=s),l=n;break;default:return null}return{rowId:t.rows[a]?.id??i.rowId,columnId:t.columns[l]?.id??i.columnId}}function ad(t,e){return{anchor:e,pointerId:t,moved:!1}}function Fo(t,e){return t.pointerId!==null&&t.anchor!==null&&t.pointerId===e}function ld(t){return{...t,moved:!0}}function hn(){return{anchor:null,pointerId:null,moved:!1}}function cd(t,e){return e&&t.moved}function dd(t,e){return e?{pointerId:t,sourceRange:e}:null}function Do(t,e){return t.pointerId!==null&&t.pointerId===e}function pn(){return{pointerId:null,sourceRange:null}}function Li(t,e){if(typeof e!="string")return;let i=e.trim();if(!(!i||/[;{}\\]|\/\*|url\s*\(|expression\s*\(/i.test(i))&&!(typeof CSS<"u"&&typeof CSS.supports=="function"&&!CSS.supports(t,i)))return i}function ud(t){let{focusMode:e,rows:i,columns:r,activeCell:o}=t;if(e!=="cell"||!i.length||!r.length||!o)return null;let s=i.some(a=>a.id===o.rowId),n=r.some(a=>a.id===o.columnId);return!s||!n?Lr(i,r):o}function hd(t){let{focusMode:e,activeCell:i,cellSelection:r,isValidLocation:o}=t;return e!=="cell"?null:!i||!r?r:!o(r.anchor)||!o(r.focus)?null:r}function pd(t){let{focusMode:e,fillPreview:i,isValidLocation:r}=t;return e!=="cell"||!i||!r(i.anchor)||!r(i.focus)?null:i}function fd(t){let{focusMode:e,editingCell:i,editingValue:r,isEditableLocation:o}=t;return e!=="cell"?{editingCell:null,editingValue:""}:i?o(i)?{editingCell:i,editingValue:r}:{editingCell:null,editingValue:""}:{editingCell:i,editingValue:r}}function md(t,e){let i=Li("width",e.resolvedWidth)??"var(--violet-data-grid-default-column-width, 12rem)";return{id:t.id,label:t.label,sortable:t.sortable??!1,width:i,widthStyle:`width:${i};inline-size:${i};min-inline-size:${i};max-inline-size:${i};`,align:t.align??"start",headerPart:t.headerPart,headerPartText:e.mergePartNames("header-cell",t.headerPart),cellPart:t.cellPart,cellPartText:e.mergePartNames("cell",t.cellPart),source:t}}function gd(t,e,i){let r=t.label?.trim()||t.id;return{id:t.id,label:r,data:t.data,cells:e.map(o=>{let s=i.cellValueFor(t,o);return{rowId:t.id,rowLabel:r,columnId:o.id,columnLabel:o.label,rowData:t.data,align:o.align,rawValue:s,text:i.serializeCellValue(o.source,t.data,s),widthStyle:o.widthStyle,cellId:i.cellIdFor(t.id,o.id),active:!1,selected:!1,rangeEdge:"",editable:o.source.editable??!1,editor:o.source.editor??"text",editing:!1,editValue:"",editingError:"",editingErrorId:i.editingErrorIdFor(t.id,o.id),fillPreview:!1,cellPart:o.cellPart,cellPartText:o.cellPartText,resolvedCellPartText:o.cellPartText,cellTemplate:o.source.cellTemplate,editorTemplate:o.source.editorTemplate,editorOptions:i.editorOptionsForColumn(o.source,t.data),parse:o.source.parse}})}}function vd(t){return t.button!==0?null:{pointerId:t.pointerId,columnId:t.columnId,startX:t.clientX,startWidth:t.startWidth}}function Mo(t,e){return t.pointerId!==null&&t.columnId!==null&&e===t.pointerId}function fn(t){return Math.max(t.minimumWidth,Math.round(t.session.startWidth+(t.clientX-t.session.startX)))}var $m=8,Em=32;function bd(t){if(t.key!=="ArrowLeft"&&t.key!=="ArrowRight")return null;let e=t.shiftKey?Em:$m,i=t.key==="ArrowRight"!==t.rtl;return Math.max(t.minimumWidth,Math.round(t.currentWidth+(i?e:-e)))}function mn(){return{pointerId:null,columnId:null,startX:0,startWidth:0}}var Oo="Control+Alt+R";function gn(t){return t.ctrlKey&&t.altKey&&!t.metaKey&&!t.shiftKey&&t.code==="KeyR"}function Tm(t,e,i){let r=t.findIndex(s=>s.id===i.rowId),o=e.findIndex(s=>s.id===i.columnId);return r<0||o<0?null:{rowIndex:r,columnIndex:o}}function Vr(t,e,i,r){let o=t[i],s=e[r];return!o||!s?null:{rowId:o.id,columnId:s.id}}function yd(t,e,i){let r=Vr(t,e,i.rowStart,i.columnStart),o=Vr(t,e,i.rowEnd,i.columnEnd);return r&&o?{anchor:r,focus:o}:null}function xd(t,e,i,r){if(!i)return r?[r]:[];let o=[];for(let s=i.rowStart;s<=i.rowEnd;s+=1){let n=t[s];if(n)for(let a=i.columnStart;a<=i.columnEnd;a+=1){let l=e[a];l&&o.push({rowId:n.id,columnId:l.id})}}return o}function wd(t,e,i,r){let o=Tm(t,e,i);if(!o)return null;let n=o.rowIndex*e.length+o.columnIndex+r;if(n<0||n>=t.length*e.length)return null;let a=Math.floor(n/e.length),l=n%e.length;return Vr(t,e,a,l)}function Cd(t,e,i){let r=i.find(o=>o.id===t);return e?.[t]??r?.width}function vn(t){let e=getComputedStyle(t);return parseFloat(e.paddingInlineStart||"0")+parseFloat(e.paddingInlineEnd||"0")}function _d(t,e=null){if(!t)return`500 14px ${(e?getComputedStyle(e).fontFamily:"")||"sans-serif"}`;let i=getComputedStyle(t);return i.font||`${i.fontStyle} ${i.fontVariant} ${i.fontWeight} ${i.fontSize} / ${i.lineHeight} ${i.fontFamily}`}function kd(t,e,i){let o=(i??document.createElement("canvas")).getContext("2d");return o?(o.font=e,o.measureText(t).width):t.length*8}function Im(t){if(!t)return null;if(t.endsWith("px"))return Number.parseFloat(t);let e=document.createElement("div");e.style.position="absolute",e.style.visibility="hidden",e.style.inlineSize=t,document.body.append(e);let i=e.getBoundingClientRect().width;return e.remove(),i||null}function Pr(t){let e=t?vn(t):0;return Math.max(72,Math.ceil(32+e))}function zd(t){let{headerCell:e,resolvedWidth:i}=t,r=e?.getBoundingClientRect().width;return r&&r>0?r:Im(i)??Pr(e)}function Sd(t){let{columnId:e,column:i,headerCell:r,sampleCell:o,getCellText:s,sampleRows:n,measurementCanvas:a,fontSource:l=null}=t;if(!i)return Pr(r);let d=_d(r,l),h=_d(o,l),p=r?vn(r):0,x=o?vn(o):p,k=i.sortable?24:0,S=14,A=0;for(let T of n){let I=kd(s({rowId:T.id,columnId:e}),h,a);I>A&&(A=I)}let D=kd(i.label,d,a),_=Math.ceil(Math.max(D+p+k+S,A+x));return Math.max(Pr(r),_)}var Am=["a[href]","area[href]","button",'input:not([type="hidden"])',"select","textarea","label","summary","audio[controls]","video[controls]",'[contenteditable]:not([contenteditable="false"])'].join(",");function $d(t){return t instanceof Element?t:t instanceof Node?t.parentElement:null}function Ed(t){return t instanceof HTMLElement&&t.classList.contains("cell-editor")}function Rm(t){let e=$d(t);return e!==null&&e.closest(Am)!==null}function bn(t){let e=$d(t);return e?e.closest("[data-cell-widget]")!==null||Rm(e):!1}function Td(t){return t instanceof HTMLElement&&t.closest('[data-fill-handle="true"]')!==null}function Id(t){return t==null?"":String(t)}function Lo(t){if(typeof t=="boolean")return t;if(typeof t=="number")return Number.isFinite(t)&&t!==0;if(typeof t=="string"){let e=t.trim().toLowerCase();return e==="true"||e==="1"||e==="yes"||e==="on"}return!1}function yn(t,e){if(t.parse)return t.parse(e,t.rowData);if(t.editor==="checkbox")return Lo(e);if(t.editor==="number"){let i=String(e??"");if(i.trim()==="")return null;let r=Number(i);return Number.isNaN(r)?i:r}return e}function Ad(t,e){if(t.editor==="number"&&!t.parse){let i=String(e??"");if(i.trim()!==""&&!Number.isFinite(Number(i)))return{valid:!1,message:"Enter a valid number."}}try{return{valid:!0,value:yn(t,e)}}catch(i){return{valid:!1,message:i instanceof Error&&i.message.trim()?i.message:"Enter a valid value."}}}function Rd(t){return t==="select"||t==="custom"}function Fd(t){if(!t.virtualize)return{renderedRows:t.rows.map((r,o)=>({item:{key:r.id,index:o,start:o*t.estimatedRowHeight,end:(o+1)*t.estimatedRowHeight,size:t.estimatedRowHeight,lane:0},row:r})),virtualPaddingStart:0,virtualPaddingEnd:0};let e=t.virtualItems[0],i=t.virtualItems[t.virtualItems.length-1];return{renderedRows:t.virtualItems.map(r=>{let o=t.rows[r.index];return o?{item:r,row:o}:null}).filter(r=>r!==null),virtualPaddingStart:e?.start??0,virtualPaddingEnd:Math.max(0,t.totalSize-(i?.end??0))}}function Dd(t){return{count:t.rows.length,estimateSize:()=>t.estimatedRowHeight,overscan:t.overscanCount,enabled:t.virtualize&&t.rows.length>0,getItemKey:e=>t.rows[e]?.id??e}}Es();Ts();var Fm=u`
    <tr
        part="row"
        data-index="${t=>String(t.item.index)}"
        data-selected="${(t,e)=>String(e.parent.isRowSelected(t.row.id))}"
        data-row-index="${t=>String(t.item.index)}"
        aria-rowindex="${t=>String(t.item.index+2)}"
        aria-selected="${(t,e)=>e.parent.selectionMode==="none"?null:String(e.parent.isRowSelected(t.row.id))}"
    >
        <td
            class="selection-cell"
            part="cell"
            headers="${(t,e)=>e.parent.selectionHeaderId}"
            ?hidden="${(t,e)=>e.parent.selectionMode==="none"}"
        >
            ${b((t,e)=>e.parent.selectionMode==="single",u`
                    <violet-radio
                        class="selection-radio"
                        inline
                        value="${t=>t.row.id}"
                        name="${(t,e)=>e.parent.selectionControlName}"
                        aria-label="${(t,e)=>e.parent.selectionLabelFor(t.row.id,t.row.label)}"
                        :checked="${(t,e)=>e.parent.isRowSelected(t.row.id)}"
                        @pointerdown="${(t,e)=>e.parent.handleSelectionControlPointerDown(e.event)}"
                        @click="${(t,e)=>e.parent.handleSelectionControlClick(e.event)}"
                        @change="${(t,e)=>e.parent.handleRowSelection(t.row.id,e.event)}"
                    ></violet-radio>
                `)}
            ${b((t,e)=>e.parent.selectionMode==="multiple",u`
                    <violet-checkbox
                        class="selection-checkbox"
                        inline
                        aria-label="${(t,e)=>e.parent.selectionLabelFor(t.row.id,t.row.label)}"
                        :checked="${(t,e)=>e.parent.isRowSelected(t.row.id)}"
                        @pointerdown="${(t,e)=>e.parent.handleSelectionControlPointerDown(e.event)}"
                        @click="${(t,e)=>e.parent.handleRowCheckboxClick(t.row.id,e.event)}"
                    ></violet-checkbox>
                `)}
        </td>
        ${L(t=>t.row.cells,u`
                <td
                    id="${t=>t.cellId}"
                    headers="${(t,e)=>e.parentContext.parent.columnHeaderIdFor(t.columnId)}"
                    part="${t=>t.resolvedCellPartText}"
                    data-align="${t=>t.align}"
                    data-row-id="${t=>t.rowId}"
                    data-column-id="${t=>t.columnId}"
                    data-active="${t=>String(t.active)}"
                    data-selected="${t=>String(t.selected)}"
                    data-fill-preview="${t=>String(t.fillPreview)}"
                    data-editing="${t=>String(t.editing)}"
                    data-range-edge="${t=>t.rangeEdge}"
                    style="${t=>t.widthStyle}"
                >
                    ${b(t=>t.editing&&(t.editor==="text"||t.editor==="number"),u`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${si(t=>t,t=>t.cellTemplate??Oi)}
                            </span>
                            ${Fc}
                        `)}
                    ${b(t=>t.editing&&t.editor==="select",u`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${si(t=>t,t=>t.cellTemplate??Oi)}
                            </span>
                            ${Dc}
                        `)}
                    ${b(t=>t.editing&&t.editor==="custom",u`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${si(t=>t,t=>t.cellTemplate??Oi)}
                            </span>
                            ${si(t=>t,t=>t.editorTemplate??Oi)}
                        `)}
                    ${b(t=>!t.editing&&t.editor==="checkbox",u`
                            <span class="cell-widget" data-align="${t=>t.align}">
                                <violet-checkbox
                                    class="cell-checkbox"
                                    data-cell-widget="checkbox"
                                    inline
                                    aria-label="${t=>`${t.columnLabel} for ${t.rowLabel}`}"
                                    :checked="${t=>Lo(t.rawValue)}"
                                    ?disabled="${t=>!t.editable}"
                                    @click="${(t,e)=>e.parentContext.parent.handleCellCheckboxClick(t.rowId,t.columnId,e.event)}"
                                ></violet-checkbox>
                            </span>
                        `)}
                    ${b(t=>t.editing&&!!t.editingError,u`
                          <span
                              class="cell-editor-error"
                              id="${t=>t.editingErrorId}"
                              role="alert"
                          >${t=>t.editingError}</span>
                      `)}
                    ${b(t=>t.editing&&!!t.editingHint,u`
                          <span class="cell-editor-hint" id="${t=>t.editingHintId}"
                          >${t=>t.editingHint}</span>
                      `)}
                    ${b(t=>!t.editing&&t.editor!=="checkbox",u`
                            ${si(t=>t,t=>t.cellTemplate??Oi)}
                        `)}
                    ${b((t,e)=>e.parentContext.parent.shouldShowFillHandleForCell(t.rowId,t.columnId),u`
                            <span class="fill-handle" data-fill-handle="true" aria-hidden="true"></span>
                        `)}
                </td>
            `)}
    </tr>
`,Dm=u`
    <div class="table-canvas" style="--_virtual-total-size:${t=>`${t.virtualTotalSize}px`};">
        <table
            class="table-full-table"
            part="table"
            aria-rowcount="${t=>String(t.logicalRowCount)}"
            aria-colcount="${t=>String(t.logicalColumnCount)}"
                >
        <colgroup>
            <col
                class="selection-column"
                style="${t=>t.selectionMode==="none"?"width:0;inline-size:0;min-inline-size:0;max-inline-size:0;":"width:var(--_selection-column-size);inline-size:var(--_selection-column-size);min-inline-size:var(--_selection-column-size);max-inline-size:var(--_selection-column-size);"}"
            />
                ${L(t=>t.presentedColumns,u`
                    <col data-column-id="${t=>t.id}" style="${t=>t.widthStyle}" />
                `)}
        </colgroup>
        <thead part="head">
            <tr part="header-row">
                <th
                    id="${t=>t.selectionHeaderId}"
                    class="selection-header"
                    part="header-cell selection-header-cell"
                    scope="col"
                    aria-label="${t=>t.selectionHeaderLabel}"
                    ?hidden="${t=>t.selectionMode==="none"}"
                >
                    <span class="visually-hidden">${t=>t.selectionHeaderLabel}</span>
                    ${b(t=>t.selectionMode==="multiple"&&t.presentedRows.length>0,u`
                            <violet-checkbox
                                class="selection-checkbox"
                                inline
                                aria-label="Select all rows"
                                :checked="${t=>t.allRowsSelected}"
                                :indeterminate="${t=>t.partiallySelected}"
                                @pointerdown="${(t,e)=>t.handleSelectionControlPointerDown(e.event)}"
                                @click="${(t,e)=>t.handleToggleAllCheckboxClick(e.event)}"
                            ></violet-checkbox>
                        `)}
                </th>
                ${L(t=>t.presentedColumns,u`
                        <th
                            id="${(t,e)=>e.parent.columnHeaderIdFor(t.id)}"
                            part="${t=>t.headerPartText}"
                            scope="col"
                            data-column-id="${t=>t.id}"
                            data-align="${t=>t.align}"
                            aria-sort="${(t,e)=>e.parent.sortStateFor(t.id)}"
                            style="${t=>t.widthStyle}"
                            tabindex="${(t,e)=>t.sortable?null:e.parent.columnHeaderTabIndexFor(t.id)}"
                            aria-keyshortcuts="${t=>t.sortable?null:Oo}"
                            @keydown="${(t,e)=>e.parent.handleColumnHeaderKeydown(t.id,e.event)}"
                            @focusin="${(t,e)=>e.parent.handleColumnHeaderFocus(t.id,e.event)}"
                        >
                            ${b(t=>t.sortable,u`
                                    <button
                                        class="header-button"
                                        type="button"
                                        tabindex="${(t,e)=>e.parent.columnHeaderTabIndexFor(t.id)}"
                                        aria-keyshortcuts="${()=>Oo}"
                                        @click="${(t,e)=>e.parent.handleSortRequest(t.id)}"
                                    >
                                        <span class="header-label">${t=>t.label}</span>
                                        <violet-icon
                                            class="sort-indicator"
                                            data-sorted="${(t,e)=>String(e.parent.isSortedColumn(t.id))}"
                                            icon="${(t,e)=>e.parent.sortIconNameFor(t.id)}"
                                            decorative
                                        ></violet-icon>
                                    </button>
                                `)}
                            ${b(t=>!t.sortable,u`
                                    <span class="header-label">${t=>t.label}</span>
                                `)}
                            <button
                                class="column-resizer"
                                type="button"
                                tabindex="-1"
                                aria-label="${t=>`Resize ${t.label} column`}"
                                data-column-resizer="${t=>t.id}"
                                @pointerdown="${(t,e)=>e.parent.handleColumnResizePointerDown(t.id,e.event)}"
                                @pointermove="${(t,e)=>e.parent.handleColumnResizePointerMove(e.event)}"
                                @pointerup="${(t,e)=>e.parent.handleColumnResizePointerUp(e.event)}"
                                @pointercancel="${(t,e)=>e.parent.handleColumnResizePointerCancel(e.event)}"
                                @dblclick="${(t,e)=>e.parent.handleColumnResizeDoubleClick(t.id,e.event)}"
                                @keydown="${(t,e)=>e.parent.handleColumnResizeKeyDown(t.id,e.event)}"
                            ></button>
                        </th>
                    `)}
            </tr>
        </thead>
        <tbody part="body">
            <tr
                class="virtual-spacer-row"
                aria-hidden="true"
                ?hidden="${t=>!t.virtualize||t.virtualPaddingStart<=0}"
            >
                <td
                    colspan="${t=>String(t.columnSpan)}"
                    style="block-size:${t=>`${t.virtualPaddingStart}px`};"
                ></td>
            </tr>
            ${L(t=>t.renderedRows,Fm)}
            <tr
                class="virtual-spacer-row"
                aria-hidden="true"
                ?hidden="${t=>!t.virtualize||t.virtualPaddingEnd<=0}"
            >
                <td
                    colspan="${t=>String(t.columnSpan)}"
                    style="block-size:${t=>`${t.virtualPaddingEnd}px`};"
                ></td>
            </tr>
        </tbody>
    </table>
    </div>
`,Mm=u`
    <div class="grid-shell">
        ${b(t=>t.shouldShowToolbar,u`
                <div class="toolbar" part="toolbar">
                    ${b(t=>t.showsBuiltInFilter,u`
                            <div class="filter-shell">
                                <violet-text-field
                                    class="filter-field"
                                    aria-label="Filter rows"
                                    type="search"
                                    :value="${t=>t.filterState.query??""}"
                                    placeholder="Filter visible rows"
                                    @input="${(t,e)=>t.handleFilterInput(e.event)}"
                                ></violet-text-field>
                            </div>
                        `)}
                    <div class="toolbar-meta">
                        <span>${t=>t.rowSummary}</span>
                        <div class="toolbar-slot">
                            <slot
                                name="toolbar"
                                @slotchange="${(t,e)=>t.handleToolbarSlotChange(e.event)}"
                            ></slot>
                        </div>
                    </div>
                </div>
            `)}

        <slot class="default-slot"></slot>

        <div class="table-region">
            <div
                class="edit-status"
                part="edit-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >${t=>t.editAnnouncement}</div>
            ${b(t=>t.presentedRows.length>0,u`
                            <div
                                class="table-scroll"
                                role="${t=>t.getAttribute("aria-label")?"group":null}"
                                aria-label="${t=>t.getAttribute("aria-label")}"
                                tabindex="${t=>t.focusMode==="cell"?"0":"-1"}"
                                aria-describedby="${t=>t.focusMode==="cell"?t.activeCellLabelId:null}"
                                aria-keyshortcuts="${t=>t.focusMode==="cell"?Oo:null}"
                                @focus="${t=>t.handleGridFocus()}"
                                @click="${(t,e)=>t.handleGridClick(e.event)}"
                                @dblclick="${(t,e)=>t.handleGridDoubleClick(e.event)}"
                                @pointerdown="${(t,e)=>t.handleGridPointerDown(e.event)}"
                                @pointermove="${(t,e)=>t.handleGridPointerMove(e.event)}"
                                @pointerup="${(t,e)=>t.handleGridPointerUp(e.event)}"
                                @pointercancel="${(t,e)=>t.handleGridPointerCancel(e.event)}"
                                @focusout="${(t,e)=>t.handleGridFocusOut(e.event)}"
                                @input="${(t,e)=>t.handleGridInput(e.event)}"
                                @change="${(t,e)=>t.handleGridChange(e.event)}"
                                @copy="${(t,e)=>t.handleGridCopy(e.event)}"
                                @paste="${(t,e)=>t.handleGridPaste(e.event)}"
                                @keydown="${(t,e)=>t.handleGridKeydown(e.event)}"
                            >
                                ${b(t=>t.focusMode==="cell",u`
                                        <span class="visually-hidden" id="${t=>t.activeCellLabelId}">
                                            ${t=>t.activeCellDescription}
                                        </span>
                                    `)}
                                ${Dm}
                            </div>
                `)}

            ${b(t=>t.presentedRows.length===0&&!t.busy,u`
                    <div class="empty-state" part="empty-state">
                        <slot name="empty">No rows available.</slot>
                    </div>
                `)}

            ${b(t=>t.busy,u`
                    <div class="loading-overlay" part="loading-state">
                        <slot name="loading">Loading rows...</slot>
                    </div>
                `)}
        </div>
    </div>
`,N=class extends f{#e;#t;#i;#r;#n;#s;#o;#a;#l;#c;#d;#u;#h;#p;#f;#m;#v;#b;#y;#k;#R;#w;#F;#S;#_;#B;#C;#T;#x;#$;#I;#L;#D;#E;#A;#N;#g;#V;#z;#j;constructor(){super(),this.instanceId=++Om,this.#i=null,this.#r=null,this.#n=null,this.#s=hn(),this.#o=!1,this.#a=!1,this.#l=pn(),this.#c=null,this.#d=null,this.#u=0,this.#h=mn(),this.#p=null,this.#f=null,this.#m=new Map,this.#v=new Map,this.#b=new Set,this.#y=0,this.#k=new Map,this.#R=new WeakMap,this.#w=new Map,this.#F=new Map,this.#S=0,this.#_=0,this.#B=-1,this.#C=-1,this.#T=!0,this.#x=!1,this.#$=!1,this.#I=null,this.#L=0,this.#D=0,this.#E=null,this.#A=null,this.#N=0,this.#g=null,this.#V=null,this.#z=null,this.#j=null,this.#O=()=>{this.#L+=1},this.#e=this.attachInternals(),this.selectionMode="none",this.stickyHeader=!1,this.busy=!1,this.virtualize=!1,this.density="natural",this.focusMode="row",this.sortMode="local",this.columns=[],this.columnWidths={},this.rows=[],this.showFilter=!1,this.sort=null,this.filterState={},this.selectedRowIds=[],this.presentedColumns=[],this.presentedRows=[],this.renderedRows=[],this.activeCell=null,this.cellSelection=null,this.editingCell=null,this.editingValue="",this.editingError="",this.editAnnouncement="",this.fillPreview=null,this.#x=!0,this.estimatedRowHeight=this.rowHeightForDensity(this.density),this.#x=!1,this.overscanCount=5,this.virtualPaddingStart=0,this.virtualPaddingEnd=0,this.virtualTotalSize=0,this.hasToolbarSlotContent=!1,this.headerFocusColumnId=null,this.#t=new Eo({count:0,getScrollElement:()=>this.getScrollContainer(),estimateSize:()=>this.estimatedRowHeight,scrollToFn:Cc,observeElementRect:_c,observeElementOffset:kc,overscan:this.overscanCount,getItemKey:e=>this.presentedRows[e]?.id??e,enabled:!1,onChange:()=>{this.syncRenderedRows()}})}connectedCallback(){this.refreshPresentation(),super.connectedCallback(),this.ownerDocument.addEventListener("focusin",this.#O,!0),this.ownerDocument.addEventListener("pointerdown",this.#O,!0),this.#i??=this.#t._didMount(),this.hasToolbarSlotContent=this.querySelector('[slot="toolbar"]')!==null,this.syncHostStates(),this.scheduleVirtualizerUpdate()}disconnectedCallback(){this.cancelActiveEdit(),this.ownerDocument.removeEventListener("focusin",this.#O,!0),this.ownerDocument.removeEventListener("pointerdown",this.#O,!0),this.#r!==null&&(cancelAnimationFrame(this.#r),this.#r=null),this.#I!==null&&(cancelAnimationFrame(this.#I),this.#I=null),this.#D+=1,this.#E!==null&&(cancelAnimationFrame(this.#E),this.#E=null),this.#n!==null&&(cancelAnimationFrame(this.#n),this.#n=null),this.#t.measureElement(null),this.#i?.(),this.#i=null,super.disconnectedCallback()}selectionModeChanged(){if(this.selectionMode==="none"){this.selectedRowIds=[];return}this.selectionMode==="single"&&this.selectedRowIds.length>1&&(this.selectedRowIds=this.selectedRowIds.slice(0,1)),this.updateInteractionState(),this.scheduleVirtualizerUpdate()}stickyHeaderChanged(){this.syncHostStates()}busyChanged(){this.syncHostStates()}virtualizeChanged(){this.syncHostStates(),this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}focusModeChanged(){if(this.focusMode!=="cell"){this.cancelActiveEdit(),this.activeCell=null,this.cellSelection=null,this.fillPreview=null;return}!this.activeCell&&this.presentedRows.length>0&&this.presentedColumns.length>0&&(this.activeCell=this.firstCellLocation())}sortModeChanged(){this.schedulePresentationRefresh()}columnsChanged(){this.captureActiveEditorSelection(),this.cancelEditIfSourceTargetInvalidated(),this.#z=this.#g?.id??null,this.#y+=1,this.#w.clear(),this.schedulePresentationRefresh()}columnWidthsChanged(){this.#y+=1,this.schedulePresentationRefresh()}rowsChanged(){this.rows.length===0&&(this.editAnnouncement=""),this.captureActiveEditorSelection(),this.cancelEditIfSourceTargetInvalidated(),this.#z=this.#g?.id??null,this.#k.clear(),this.#w.clear(),this.schedulePresentationRefresh()}showFilterChanged(){this.syncHostStates()}sortChanged(){this.commitActiveEdit(),this.clearRangeSelectionState(),this.schedulePresentationRefresh()}selectedRowIdsChanged(){this.#b=new Set(this.selectedRowIds??[]),this.#_+=1,this.syncRenderedRows()}activeCellChanged(){this.focusMode==="cell"&&(this.updateInteractionState(),this.ensureActiveCellVisible(),this.$emit("active-cell-change",this.activeCell))}cellSelectionChanged(){this.focusMode==="cell"&&(this.updateInteractionState(),this.$emit("cell-selection-change",this.cellSelection))}editingCellChanged(){this.editingCell?this.sameEditingLocation(this.#g?.location,this.editingCell)||(this.#g={id:++this.#N,location:{...this.editingCell}},this.editingError=""):(this.#g=null,this.editingError=""),this.updateInteractionState(),!(!this.editingCell||!this.#g)&&this.scheduleEditorRestore(this.#g.id)}fillPreviewChanged(){this.focusMode==="cell"&&this.updateInteractionState()}estimatedRowHeightChanged(){this.#x||(this.#T=!1),this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}densityChanged(){this.#T&&(this.#x=!0,this.estimatedRowHeight=this.rowHeightForDensity(this.density),this.#x=!1),this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}overscanCountChanged(){this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}get hasRows(){return this.presentedRows.length>0}get columnSpan(){return this.presentedColumns.length+1}get logicalRowCount(){return this.presentedRows.length+1}get logicalColumnCount(){return this.presentedColumns.length+(this.selectionMode==="none"?0:1)}get selectionHeaderId(){return`${this.localName}-selection-header-${this.instanceId}`}columnHeaderIdFor(e){return`${this.localName}-header-${this.instanceId}-${this.sanitizeForId(e)}`}get filterQuery(){return this.filterState.query??""}get showsBuiltInFilter(){return this.showFilter}get shouldShowToolbar(){return this.showsBuiltInFilter||this.hasToolbarSlotContent}get activeCellLabelId(){return`${this.localName}-active-cell-${this.instanceId}`}get activeCellDescription(){if(!this.activeCell)return"No active cell.";let e=this.#m.get(this.activeCell.rowId)??-1,i=this.#v.get(this.activeCell.columnId)??-1,r=this.presentedColumns[i]?.label??this.activeCell.columnId,o=this.cellTextAt(this.activeCell)||"empty",s=this.columnAccessoryText(this.activeCell.columnId,this.presentedRows[e]?.data,"describe");return`Active cell row ${e+1}, column ${r}, value ${o}${s?`, ${s}`:""}.`}get rowSummary(){let e=this.presentedRows.length,i=this.selectedRowIds.filter(r=>this.#m.has(r)).length;return this.selectionMode==="none"?`${e} row${e===1?"":"s"}`:`${i} selected / ${e} row${e===1?"":"s"}`}get selectionHeaderLabel(){return this.selectionMode==="multiple"?"Select rows":this.selectionLabel?.trim()||"Selected row"}get selectionControlName(){return`${this.localName}-selection-${this.instanceId}`}get allRowsSelected(){let e=this.selectedRowIds??[];return this.hasRows&&e.length>=this.presentedRows.length&&this.presentedRows.every(i=>this.#b.has(i.id))}get partiallySelected(){if((this.selectedRowIds??[]).length===0)return!1;let i=this.presentedRows.filter(r=>this.#b.has(r.id)).length;return i>0&&i<this.presentedRows.length}sortStateFor(e){return!this.sort||this.sort.columnId!==e?"none":this.sort.direction}sortDirectionFor(e){return!this.sort||this.sort.columnId!==e?"ascending":this.sort.direction}isSortedColumn(e){return this.sort?.columnId===e}sortIconNameFor(e){return this.sortDirectionFor(e)==="descending"?"system/sort-descending":"system/sort-ascending"}isRowSelected(e){return this.#b.has(e)}selectionLabelFor(e,i){let r=i?.trim()||e,o=this.selectionLabel?.trim();return o&&this.selectionMode==="single"?`${o} ${r}`:`Select row ${r}`}handleToolbarSlotChange(e){let i=e.target;this.hasToolbarSlotContent=!!i?.assignedNodes({flatten:!0}).length}handleFilterInput(e){let i=e.currentTarget;if(this.editingCell&&!this.commitActiveEdit()){i&&(i.value=this.filterState.query??""),this.refocusActiveEditor();return}let r={...this.filterState,query:i?.value??""};this.clearRangeSelectionState(),this.filterState=r,this.$emit("filter-change",r)}handleSelectionControlPointerDown(e){e.stopPropagation()}handleSelectionControlClick(e){e.stopPropagation()}handleToggleAllCheckboxClick(e){e.stopPropagation();let i=e.currentTarget,r=!this.allRowsSelected;i&&(i.checked=r,"indeterminate"in i&&(i.indeterminate=!1)),this.updateSelection(r?this.presentedRows.map(o=>o.id):[])}handleRowCheckboxClick(e,i){i.stopPropagation();let r=i.currentTarget,o=!(r?.checked??!1);r&&(r.checked=o,"indeterminate"in r&&(r.indeterminate=!1));let s=new Set(this.selectedRowIds);o?s.add(e):s.delete(e),this.updateSelection([...s])}handleCellCheckboxClick(e,i,r){r.stopPropagation();let o={rowId:e,columnId:i};if(this.editingCell&&!this.sameEditingLocation(this.editingCell,o)&&!this.commitActiveEdit()){this.refocusActiveEditor();return}let s=this.presentedCellAt(o);if(!s?.editable||s.editor!=="checkbox")return;let n=r.currentTarget,a=!this.booleanCellValue(s.rawValue);n&&(n.checked=a,"indeterminate"in n&&(n.indeterminate=!1)),this.commitCheckboxCellToggle(o,a)}handleGridFocus(){this.focusMode!=="cell"||this.activeCell||!this.presentedRows.length||!this.presentedColumns.length||(this.activeCell=this.firstCellLocation())}handleGridKeydown(e){if(this.focusMode!=="cell"||e.isComposing||e.keyCode===229)return!0;let i=e.target;if(this.isEditorElement(i))return e.key==="Enter"?(e.preventDefault(),this.commitActiveEdit()?this.getScrollContainer()?.focus({preventScroll:!0}):this.refocusActiveEditor(),!1):e.key==="Tab"?(e.preventDefault(),this.commitEditingCellAndMove(e.shiftKey?-1:1),!1):e.key==="Escape"?(e.preventDefault(),this.cancelActiveEdit(),this.getScrollContainer()?.focus({preventScroll:!0}),!1):!0;if(i&&i!==this.getScrollContainer())return!0;if(gn(e)&&this.activeCell)return e.preventDefault(),!this.focusColumnResizer(this.activeCell.columnId,this.getScrollContainer());if(e.key==="Tab"){let o=this.activeCell??this.firstCellLocation();if(!o)return!0;let s=this.nextTabCellLocation(o,e.shiftKey?-1:1);return s?(e.preventDefault(),this.setActiveCell(s),!1):!0}if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==="c")return this.#a=!0,setTimeout(()=>{this.#a&&(this.#a=!1,this.handleCopyRequest())},0),!0;if((e.key===" "||e.key==="Spacebar"||e.key==="Enter")&&this.activeCell){let o=this.presentedCellAt(this.activeCell);if(o?.editable&&o.editor==="checkbox")return e.preventDefault(),this.commitCheckboxCellToggle(this.activeCell,!this.booleanCellValue(o.rawValue)),!1}if((e.key==="Enter"||e.key==="F2")&&this.activeCell)return this.presentedCellAt(this.activeCell)?.editable?(e.preventDefault(),this.startEditingCell(this.activeCell),!1):!0;if(e.key==="ArrowUp"&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.activeCell&&this.activeCell.rowId===this.presentedRows[0]?.id){let o=this.columnHeaderFocusTargetFor(this.activeCell.columnId);if(o)return e.preventDefault(),o.focus(),!1}let r=this.nextCellLocationForKey(e);return r?(e.preventDefault(),this.setActiveCell(r,{extendRange:e.shiftKey}),!1):!0}handleGridClick(e){if(this.focusMode!=="cell")return!0;if(this.#o)return this.#o=!1,!0;let i=e.target;if(this.isEditorEvent(e)||this.isEditorElement(i)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(i))return!0;let r=e,o=this.locationFromMouseEvent(r)??this.locationFromEvent(e)??this.locationFromTarget(i);if(!o){if(r.detail>=2&&this.activeCell){let h=this.presentedCellAt(this.activeCell);h?.editable&&h.editor!=="checkbox"&&this.startEditingCell(this.activeCell)}return!0}if(this.editingCell&&!this.sameEditingLocation(this.editingCell,o)&&!this.commitActiveEdit())return this.refocusActiveEditor(),!0;let s=this.activeCell?.rowId===o.rowId&&this.activeCell?.columnId===o.columnId,n=this.presentedCellAt(o);if(s&&n?.editable&&this.opensOnSingleActiveClick(n.editor))return this.startEditingCell(o),!0;this.handleCellPointerActivate(o.rowId,o.columnId,r.shiftKey);let a=typeof r.timeStamp=="number"?r.timeStamp:performance.now(),l=this.#d?.rowId===o.rowId&&this.#d?.columnId===o.columnId,d=a-this.#u<=350;if(r.detail>=2||l&&d){let h=this.presentedCellAt(o);h?.editable&&h.editor!=="checkbox"&&this.startEditingCell(o)}return this.#d=o,this.#u=a,!0}handleGridDoubleClick(e){if(this.focusMode!=="cell")return!0;let i=e.target;if(!i&&!this.locationFromEvent(e)||this.isEditorEvent(e)||this.isEditorElement(i)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(i)||this.isFillHandleEvent(e)||this.isFillHandleTarget(i))return!0;let r=this.locationFromMouseEvent(e)??this.locationFromEvent(e)??this.locationFromTarget(i);if(!r){if(this.activeCell){let s=this.presentedCellAt(this.activeCell);if(s?.editable&&s.editor!=="checkbox")return e.preventDefault(),this.startEditingCell(this.activeCell),!1}return!0}return this.presentedCellAt(r)?.editor==="checkbox"?!0:(e.preventDefault(),this.handleCellPointerActivate(r.rowId,r.columnId,!1),this.startEditingCell(r),!1)}handleGridPointerDown(e){if(this.focusMode!=="cell"||e.button!==0||e.shiftKey||this.isEditorEvent(e)||this.isEditorElement(e.target)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(e.target))return!0;if(this.isFillHandleEvent(e)||this.isFillHandleTarget(e.target))return this.beginFillDrag(e),!1;let i=this.locationFromEvent(e)??this.locationFromTarget(e.target);if(!i)return!0;let r=this.getScrollContainer();this.#s=ad(e.pointerId,i),this.setActiveCell(i),r?.focus({preventScroll:!0});try{r?.setPointerCapture(e.pointerId)}catch{}return e.preventDefault(),!1}handleGridPointerMove(e){if(Do(this.#l,e.pointerId)){this.handleFillPointerMove(e);return}let i=this.#s;if(this.focusMode!=="cell"||!Fo(i,e.pointerId))return;let r=this.locationFromPointerEvent(e);if(!r)return;let o=i.anchor;if(!o)return;let s=this.cellSelection?.focus??o;s.rowId===r.rowId&&s.columnId===r.columnId||(this.#s=ld(i),this.cellSelection=this.createCellSelection(o,r),this.updateInteractionState())}handleGridPointerUp(e){if(Do(this.#l,e.pointerId)){this.handleFillPointerUp();return}Fo(this.#s,e.pointerId)&&this.endPointerSelection(!0)}handleGridPointerCancel(e){if(Do(this.#l,e.pointerId)){this.endFillDrag(!1);return}Fo(this.#s,e.pointerId)&&this.endPointerSelection(!1)}handleGridInput(e){let i=e.target;!this.isEditorElement(i)||!this.editingCell||(this.editingValue=this.editorValueFromTarget(i),this.editingError&&(this.editingError="",this.updateInteractionState(),this.scheduleEditorRestore(this.#g?.id??null)))}handleGridChange(e){let i=e.target;if(this.isEditorElement(i)&&this.editingCell){this.editingValue=this.editorValueFromTarget(i),(this.presentedCellAt(this.editingCell)?.editor==="select"||i.dataset.commitOnChange==="true")&&(this.commitActiveEdit()?this.getScrollContainer()?.focus({preventScroll:!0}):this.refocusActiveEditor());return}}handleGridPaste(e){if(this.focusMode!=="cell"||this.isEditorEvent(e)||this.isEditorElement(e.target))return!0;let i=e.clipboardData?.getData("text/plain")??"",r=this.pasteDetailForText(i);return r?(e.preventDefault(),this.$emit("cell-paste",r),!1):!0}handleGridFocusOut(e){let i=e.target;if(!this.isEditorElement(i))return;let r=this.#g?.id??null,o=e.relatedTarget;if(!this.isTargetWithinEditingOwnership(o)){if(o){this.commitActiveEdit()||this.refocusActiveEditor();return}if(r&&this.#z===r){this.captureEditorSelection(i,r),this.scheduleEditorRestore(r,!0);return}requestAnimationFrame(()=>{if(!this.editingCell||!r||this.#g?.id!==r)return;let s=this.getActiveEditorElement();if(s&&s!==i){dn(s,this.editingValue),this.restoreEditorSelection(s,r);return}if(this.#z===r&&s!==i&&this.presentedCellAt(this.#g.location)?.editable){this.captureEditorSelection(i,r),this.scheduleEditorRestore(r,!0);return}if(s?.matches?.(":focus-within")||s?.shadowRoot?.activeElement)return;let a=this.shadowRoot?.activeElement;a&&this.isEditorElement(a)||this.commitActiveEdit()||this.refocusActiveEditor()})}}async handleCopyRequest(){let e=this.copyDetailForCurrentSelection();if(!e)return;this.$emit("cell-copy",e);let i=globalThis.navigator?.clipboard;if(!i?.writeText){this.$emit("cell-copy-error",{...e,error:new Error("Clipboard API is unavailable.")});return}try{await i.writeText(e.text)}catch(r){this.$emit("cell-copy-error",{...e,error:r})}}handleGridCopy(e){if(this.focusMode!=="cell"||this.isEditorEvent(e)||this.isEditorElement(e.target))return!0;this.#a=!1;let i=this.copyDetailForCurrentSelection();return!i||!e.clipboardData?!0:(e.clipboardData.setData("text/plain",i.text),e.preventDefault(),this.$emit("cell-copy",i),!1)}handleSortRequest(e){if(this.editingCell&&!this.commitActiveEdit()){this.refocusActiveEditor();return}let i=this.sort?.columnId===e?this.sort.direction:null,r;i===null?r={columnId:e,direction:"ascending"}:i==="ascending"?r={columnId:e,direction:"descending"}:r=null,this.sort=r,this.$emit("sort-change",r)}handleColumnResizePointerDown(e,i){let r=vd({button:i.button,pointerId:i.pointerId,columnId:e,clientX:i.clientX,startWidth:this.renderedColumnWidth(e)});if(!r)return;i.preventDefault(),i.stopPropagation();let o=i.currentTarget;this.#h=r,this.#p=o;try{o?.setPointerCapture(i.pointerId)}catch{}}handleColumnResizePointerMove(e){let i=this.#h;if(!Mo(i,e.pointerId)||!i.columnId)return;e.preventDefault(),e.stopPropagation();let r=fn({session:i,clientX:e.clientX,minimumWidth:this.minimumColumnWidth(i.columnId)});this.applyLiveColumnWidth(i.columnId,`${r}px`)}handleColumnResizePointerUp(e){let i=this.#h;if(!Mo(i,e.pointerId)||!i.columnId)return;e.preventDefault(),e.stopPropagation();let r=fn({session:i,clientX:e.clientX,minimumWidth:this.minimumColumnWidth(i.columnId)});this.commitColumnWidth(i.columnId,`${r}px`),this.endColumnResize()}handleColumnResizePointerCancel(e){let i=this.#h;!Mo(i,e.pointerId)||!i.columnId||(e.preventDefault(),e.stopPropagation(),this.applyLiveColumnWidth(i.columnId,this.resolvedColumnWidth(i.columnId)),this.endColumnResize())}handleColumnResizeKeyDown(e,i){if(i.key==="Escape")return i.preventDefault(),i.stopPropagation(),this.returnFocusFromColumnResizer(e),!1;if(i.key==="Tab")return this.returnFocusFromColumnResizer(e),!0;if(i.altKey||i.ctrlKey||i.metaKey)return!0;if(i.key==="Enter")return this.handleColumnResizeDoubleClick(e,i),!1;let r=bd({key:i.key,shiftKey:i.shiftKey,currentWidth:this.renderedColumnWidth(e),minimumWidth:this.minimumColumnWidth(e),rtl:getComputedStyle(this).direction==="rtl"});return r===null?!0:(i.preventDefault(),i.stopPropagation(),this.applyLiveColumnWidth(e,`${r}px`),this.commitColumnWidth(e,`${r}px`),!1)}columnHeaderTabIndexFor(e){if(this.focusMode==="cell")return"-1";let i=this.presentedColumns,r=i.some(o=>o.id===this.headerFocusColumnId)?this.headerFocusColumnId:i[0]?.id;return e===r?"0":"-1"}handleColumnHeaderFocus(e,i){i.target===this.columnHeaderFocusTargetFor(e)&&(this.headerFocusColumnId=e)}handleColumnHeaderKeydown(e,i){let r=this.columnHeaderFocusTargetFor(e);if(!r||i.target!==r)return!0;if(gn(i))return i.preventDefault(),!this.focusColumnResizer(e,r);if(i.altKey||i.ctrlKey||i.metaKey)return!0;if(i.key==="Tab")return!i.shiftKey||this.focusMode!=="cell"?!0:(i.preventDefault(),this.getScrollContainer()?.focus({preventScroll:!0}),!1);if(i.shiftKey)return!0;let o=this.presentedColumns,s=o.findIndex(a=>a.id===e),n;switch(Le(i.key,this)){case"ArrowLeft":n=o[Math.max(0,s-1)]?.id;break;case"ArrowRight":n=o[Math.min(o.length-1,s+1)]?.id;break;case"Home":n=o[0]?.id;break;case"End":n=o.at(-1)?.id;break;case"ArrowDown":return this.focusFirstRowFromHeader(e,i);default:return!0}return i.preventDefault(),n&&this.columnHeaderFocusTargetFor(n)?.focus(),!1}handleColumnResizeDoubleClick(e,i){i.preventDefault(),i.stopPropagation();let r=`${this.autosizedColumnWidth(e)}px`;this.applyLiveColumnWidth(e,r),this.commitColumnWidth(e,r)}columnResizerFor(e){return this.shadowRoot?.querySelector(`[data-column-resizer="${CSS.escape(e)}"]`)??null}columnHeaderFocusTargetFor(e){let i=this.shadowRoot?.querySelector(`th[data-column-id="${CSS.escape(e)}"]`);return i?i.querySelector(".header-button")??i:null}focusFirstRowFromHeader(e,i){let r=this.presentedRows[0]?.id;return this.focusMode!=="cell"||!r?!0:(i.preventDefault(),this.setActiveCell({rowId:r,columnId:e}),this.getScrollContainer()?.focus({preventScroll:!0}),!1)}focusColumnResizer(e,i){let r=this.columnResizerFor(e);return r?(this.#c=i,r.focus(),!0):!1}returnFocusFromColumnResizer(e){let i=this.#c;this.#c=null;let r=this.columnHeaderFocusTargetFor(e)??this.getScrollContainer();(i?.isConnected?i:r)?.focus({preventScroll:!0})}handleToggleAll(e){let r=e.currentTarget?.checked?this.presentedRows.map(o=>o.id):[];this.updateSelection(r)}handleRowSelection(e,i){if(this.selectionMode==="none")return;let o=!!i.currentTarget?.checked;if(this.selectionMode==="single"){this.updateSelection(o?[e]:[]);return}let s=new Set(this.selectedRowIds);o?s.add(e):s.delete(e),this.updateSelection([...s])}handleCellPointerActivate(e,i,r=!1){this.focusMode==="cell"&&(this.editAnnouncement="",this.setActiveCell({rowId:e,columnId:i},{extendRange:r}),this.getScrollContainer()?.focus({preventScroll:!0}))}updateSelection(e){let i=[...new Set(e)];this.selectedRowIds=i,this.$emit("selection-change",{selectedRowIds:i})}clearRangeSelectionState(){this.cellSelection&&(this.cellSelection=null),this.fillPreview&&(this.fillPreview=null)}commitColumnWidth(e,i){let r={...this.columnWidths??{},[e]:i};this.columnWidths=r,this.$emit("column-width-change",{columnId:e,width:i,columnWidths:r})}endColumnResize(){if(this.#p&&this.#h.pointerId!==null&&this.#p.hasPointerCapture?.(this.#h.pointerId))try{this.#p.releasePointerCapture(this.#h.pointerId)}catch{}this.#h=mn(),this.#p=null}schedulePresentationRefresh(){this.$fastController.isConnected&&this.refreshPresentation()}refreshPresentation(){this.#S+=1;let e=this.columns??[],i=this.rows??[],r=this.selectedRowIds??[],o=e.map(d=>this.createPresentedColumn(d)),s=this.sortRows(i,o),n=new Set(s.map(d=>d.id)),a=new Map(i.map(d=>[d.id,d])),l=r.filter(d=>n.has(d));l.length!==r.length&&(this.selectedRowIds=l,this.$emit("selection-change",{selectedRowIds:l})),this.presentedColumns=o,this.#v=new Map(o.map((d,h)=>[d.id,h])),this.#m=new Map(s.map((d,h)=>[d.id,h])),this.#b=new Set(l),this.presentedRows=s.map(d=>this.createPresentedRow(d,o));for(let[d,h]of this.#k)(!n.has(d)||a.get(d)!==h.source)&&this.#k.delete(d);for(let[d,h]of this.#w)(!n.has(d)||a.get(d)!==h.source)&&this.#w.delete(d);this.syncActiveCell(),this.syncCellSelection(),this.syncEditingCell(),this.syncFillPreview(),this.updateInteractionState(),this.syncRenderedRows(),this.scheduleVirtualizerUpdate(),this.syncHostStates()}createPresentedColumn(e){return md(e,{resolvedWidth:this.columnWidths?.[e.id]??e.width,mergePartNames:(i,r)=>this.mergePartNames(i,r)})}createPresentedRow(e,i){let r=this.#k.get(e.id);if(r?.source===e&&r.columnRevision===this.#y)return r.row;let o=e.label?.trim()||e.id,s=null,n={id:e.id,label:o,data:e.data},a=()=>(s||(s=gd(e,i,{cellValueFor:(l,d)=>this.cellValueFor(l,d),serializeCellValue:(l,d,h)=>this.serializeCellValue(l,d,h),cellIdFor:(l,d)=>this.cellIdFor(l,d),editingErrorIdFor:(l,d)=>this.cellEditorErrorIdFor(l,d),editorOptionsForColumn:(l,d)=>this.editorOptionsForColumn(l,d)}).cells),s);return this.#R.set(n,a),Object.defineProperty(n,"cells",{configurable:!1,enumerable:!0,get:()=>{let l=a();if(this.focusMode!=="cell")return l;let d=this.#m.get(e.id);return d===void 0?l:this.withInteractionState(n,d,this.interactionSnapshot()).cells}}),this.#k.set(e.id,{source:e,columnRevision:this.#y,row:n}),n}updateInteractionState(){this.#_+=1,this.syncRenderedRows()}withInteractionState(e,i,r){if(this.focusMode!=="cell")return e;let o=this.#F.get(e.id);if(o?.source===e&&o.interactionRevision===this.#_)return o.row;let s=this.#R.get(e)?.()??e.cells,n={id:e.id,label:e.label,data:e.data,cells:s.map((a,l)=>{let d={rowIndex:i,columnIndex:l},h=Tc(r.selectionBounds,d),p=Ic(r.selectionBounds,d),x=Ac(r.fillPreviewBounds,r.fillSourceBounds,d),k=this.isActiveCell(a.rowId,a.columnId),S=this.isEditingCell(a.rowId,a.columnId),A=S&&!this.editingError?this.columnAccessoryText(a.columnId,a.rowData,"editorHint"):"";return{...a,active:k,selected:h,fillPreview:x,rangeEdge:p,editing:S,editValue:S?this.editingValue:"",editingError:S?this.editingError:"",editingHint:A,editingHintId:A?this.cellEditorHintIdFor(a.rowId,a.columnId):"",resolvedCellPartText:Rc(a.cellPartText,{selected:h,rangeEdge:p,fillPreview:x,active:k,editing:S})}})};return this.#F.set(e.id,{source:e,interactionRevision:this.#_,row:n}),n}resolvedColumnWidth(e){return Cd(e,this.columnWidths,this.columns)}renderedColumnWidth(e){let i=this.headerCellElement(e);return zd({headerCell:i,resolvedWidth:this.resolvedColumnWidth(e)})}minimumColumnWidth(e){let i=this.headerCellElement(e);return Pr(i)}applyLiveColumnWidth(e,i){let r=i??"",o=CSS.escape(e);this.shadowRoot?.querySelectorAll(`[data-column-id="${o}"]`).forEach(s=>{let n=s.style;n.width=r,n.inlineSize=r,n.minInlineSize=r,n.maxInlineSize=r})}headerCellElement(e){let i=CSS.escape(e);return this.shadowRoot?.querySelector(`th[data-column-id="${i}"]`)}autosizedColumnWidth(e){let i=this.#v.get(e),r=i===void 0?void 0:this.presentedColumns[i],o=this.headerCellElement(e),s=this.cellElementForLocation(this.presentedRows[0]?{rowId:this.presentedRows[0].id,columnId:e}:null);this.#f||(this.#f=document.createElement("canvas"));let n=this.#f;return Sd({columnId:e,column:r??null,rows:this.presentedRows,headerCell:o,sampleCell:s,getCellText:a=>this.cellTextAt(a),sampleRows:Oc(this.presentedRows),measurementCanvas:n,fontSource:this})}cellValueFor(e,i){return To(e,i.source)}editorOptionsForColumn(e,i){return Nc(e,i)}serializeCellValue(e,i,r){return Hc({column:e,rowData:i,rawValue:r,booleanCellValue:o=>this.booleanCellValue(o)})}sortRows(e,i){return qc({rows:e,columns:i.map(r=>r.source),sort:this.sort,sortMode:this.sortMode,getSortKey:(r,o)=>this.sortKeyFor(r,o)})}sortKeyFor(e,i){let r=this.#w.get(e.id);if(r?.source===e&&r.column===i)return r.key;let o=Io(To(e,i));return this.#w.set(e.id,{source:e,column:i,key:o}),o}syncActiveCell(){this.activeCell=ud({focusMode:this.focusMode,rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell})}syncCellSelection(){this.cellSelection=hd({focusMode:this.focusMode,activeCell:this.activeCell,cellSelection:this.cellSelection,isValidLocation:e=>this.isValidCellLocation(e)})}syncFillPreview(){this.fillPreview=pd({focusMode:this.focusMode,fillPreview:this.fillPreview,isValidLocation:e=>this.isValidCellLocation(e)})}syncEditingCell(){let e=fd({focusMode:this.focusMode,editingCell:this.editingCell,editingValue:this.editingValue,isEditableLocation:i=>!!this.presentedCellAt(i)?.editable});if(this.editingCell&&!e.editingCell){this.cancelActiveEdit();return}this.editingCell=e.editingCell,this.editingValue=e.editingValue,this.#g&&this.scheduleEditorRestore(this.#g.id)}firstCellLocation(){return Lr(this.presentedRows,this.presentedColumns)}nextCellLocationForKey(e){return nd({rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell,key:e.key,metaKey:e.ctrlKey||e.metaKey})}setActiveCell(e,i={}){let r=i.extendRange??!1;if(this.sameEditingLocation(this.activeCell,e)||(this.editAnnouncement=""),r){let o=this.cellSelection?.anchor??this.activeCell??e;this.cellSelection=this.createCellSelection(o,e)}else this.cellSelection&&(this.cellSelection=null);this.activeCell=e,this.updateInteractionState()}startEditingCell(e){if(this.editingCell){if(this.sameEditingLocation(this.editingCell,e)){this.refocusActiveEditor();return}if(!this.commitActiveEdit()){this.refocusActiveEditor();return}}let i=this.presentedCellAt(e),r=Wc(e,i,i?this.editStringForCell(i):"");r&&(this.cellSelection=null,this.editAnnouncement="",this.editingError="",this.#g={id:++this.#N,location:{...e}},this.editingValue=r.editingValue,this.editingCell=r.editingCell,this.$emit("edit-start",e))}opensOnSingleActiveClick(e){return Rd(e)}commitActiveEdit(){let e=this.currentEditingSession();if(!e||this.#V===e.id)return!1;let i=this.presentedCellAt(e.location);if(!i?.editable||i.editor==="checkbox")return this.cancelActiveEdit();let r=this.getActiveEditorElement();r&&(this.editingValue=this.editorValueFromTarget(r)),this.#V=e.id;let o=Ad(i,this.editingValue);if(this.#V=null,this.#g?.id!==e.id)return!1;if(!o.valid)return this.editingError=o.message,this.updateInteractionState(),this.scheduleEditorRestore(e.id),!1;let s={rowId:e.location.rowId,columnId:e.location.columnId,value:o.value};return this.clearEditingSession(e.id),this.$emit("cell-change",s),!0}commitEditingCell(){return this.commitActiveEdit()}commitEditingCellAndMove(e){let i=this.editingCell;if(!i)return;if(!this.commitActiveEdit()){this.refocusActiveEditor();return}let r=this.nextTabCellLocation(i,e);this.setActiveCell(r??i),this.getScrollContainer()?.focus({preventScroll:!0})}cancelActiveEdit(){let e=this.currentEditingSession();if(!e)return!1;let i=Uc(e.location);return this.clearEditingSession(e.id),this.$emit("edit-cancel",i.cancelledCell),!0}fillSelection(e,i=1){if(this.focusMode!=="cell"||this.editingCell)return null;let r=this.currentFillSourceRange(),o=this.boundsForRange(r),s=Math.floor(i);if(!r||!o||!(s>=1)||!this.hasEditableCellsInRange(r))return null;let n=this.presentedRows.length-1,a=this.presentedColumns.length-1,l=e==="down"?Math.min(n,o.rowEnd+s):e==="up"?Math.max(0,o.rowStart-s):o.rowEnd,d=e==="right"?Math.min(a,o.columnEnd+s):e==="left"?Math.max(0,o.columnStart-s):o.columnEnd,h=this.locationForIndices(l,d),p=h?this.fillPreviewRangeForLocation(h,r):null;if(!p)return null;let x=this.fillDetailFor(r,p);return x&&this.$emit("cell-fill",x),this.cellSelection=this.createCellSelection(p.anchor,p.focus),x}currentEditingSession(){return this.editingCell?this.sameEditingLocation(this.#g?.location,this.editingCell)?this.#g:(this.#g={id:++this.#N,location:{...this.editingCell}},this.#g):null}clearEditingSession(e){this.#g?.id===e&&(this.#g=null,this.#A=null,this.#j=null,this.#z=null,this.#V=null,this.editingCell=null,this.editingValue="",this.editingError="")}sameEditingLocation(e,i){return!!(e&&i&&e.rowId===i.rowId&&e.columnId===i.columnId)}cancelEditIfSourceTargetInvalidated(){let e=this.editingCell;if(!e)return;let i=(this.rows??[]).some(o=>o.id===e.rowId),r=(this.columns??[]).find(o=>o.id===e.columnId);(!i||!r?.editable||r.editor==="checkbox")&&this.cancelActiveEdit()}scheduleEditorRestore(e,i=!1,r=0){e&&(this.#E!==null&&cancelAnimationFrame(this.#E),this.#E=requestAnimationFrame(()=>{if(this.#E=null,this.#g?.id!==e)return;let o=this.getActiveEditorElement();if(!o){if(this.#z===e&&r<3){this.scheduleEditorRestore(e,i,r+1);return}this.#z===e&&this.cancelActiveEdit();return}if(o===this.#A){if((i||this.#z===e)&&o?.focus?.({preventScroll:!0}),this.#z===e&&r<3){this.scheduleEditorRestore(e,i,r+1);return}this.#z=null;return}if(dn(o,this.editingValue),this.restoreEditorSelection(o,e),this.#A=o,this.#z===e&&r<3){this.scheduleEditorRestore(e,!0,r+1);return}this.#z=null}))}captureActiveEditorSelection(){let e=this.#g?.id,i=this.getActiveEditorElement();e&&i&&this.captureEditorSelection(i,e)}captureEditorSelection(e,i){e.selectionStart===null||e.selectionStart===void 0||(this.#j={sessionId:i,start:e.selectionStart,end:e.selectionEnd??e.selectionStart,direction:e.selectionDirection??void 0})}restoreEditorSelection(e,i){if(!e)return;let r=this.#j;if(e.focus?.({preventScroll:!0}),r?.sessionId===i&&e.setSelectionRange){e.setSelectionRange(r.start,r.end,r.direction),this.#j=null;return}Gc(e)}refocusActiveEditor(){this.scheduleEditorRestore(this.#g?.id??null,!0)}isTargetWithinEditingOwnership(e){let i=this.getActiveEditorElement();if(!i||!(e instanceof Node))return!1;if(i.contains(e)||i.shadowRoot?.contains(e))return!0;let o=(e instanceof HTMLElement?e:e.parentElement)?.closest("[data-cell-widget]")??null;if(!o)return!1;let s=o.closest("td[data-row-id][data-column-id]");return!!(s&&this.editingCell&&s.dataset.rowId===this.editingCell.rowId&&s.dataset.columnId===this.editingCell.columnId)}ensureActiveCellVisible(){if(!this.activeCell)return;let e=this.#m.get(this.activeCell.rowId);e!==void 0&&(this.virtualize&&this.#t.scrollToIndex(e,{align:"auto"}),requestAnimationFrame(()=>{let i=this.getActiveCellElement(),r=this.getScrollContainer();if(!i||!r)return;let o=i.getBoundingClientRect(),s=r.getBoundingClientRect();o.left<s.left?r.scrollLeft+=o.left-s.left:o.right>s.right&&(r.scrollLeft+=o.right-s.right),this.virtualize||(o.top<s.top?r.scrollTop+=o.top-s.top:o.bottom>s.bottom&&(r.scrollTop+=o.bottom-s.bottom))}))}cellTextAt(e){return this.presentedCellAt(e)?.text??""}createCellSelection(e,i){return sd(e,i)}isValidCellLocation(e){return!!(e&&this.#m.has(e.rowId)&&this.#v.has(e.columnId))}normalizedCellSelection(){return this.boundsForRange(this.cellSelection)}visualSelectionBounds(){return this.fillPreview?this.boundsForRange(this.fillPreview):this.normalizedCellSelection()}selectedCellLocations(){return xd(this.presentedRows,this.presentedColumns,this.normalizedCellSelection(),this.activeCell)}copyTextForLocations(e){return Vc({selection:this.normalizedCellSelection(),locations:e,rows:this.presentedRows,columns:this.presentedColumns,getCellText:i=>this.cellTextAt(i)})}copyDetailForCurrentSelection(){let e=this.selectedCellLocations();return e.length?{cells:e,text:this.copyTextForLocations(e)}:null}pasteDetailForText(e){let i=this.normalizePastedText(e);if(!i)return null;let r=this.pasteOriginLocation();if(!r)return null;let o=this.pasteChangesForText(r,i);return o.length?{origin:r,text:i,changes:o}:null}normalizePastedText(e){return Pc(e)}pasteOriginLocation(){return Bc({selection:this.normalizedCellSelection(),rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell})}pasteChangesForText(e,i){let r=this.cellIndicesFor(e);return r?ed({text:i,originIndices:r,selection:this.normalizedCellSelection(),selectedLocations:this.selectedCellLocations(),rows:this.presentedRows,columns:this.presentedColumns,normalizeValue:(o,s)=>this.normalizedEditingValue(o,s)}):[]}currentFillSourceRange(){let e=this.normalizedCellSelection();return e?this.rangeFromBounds(e):this.activeCell?{anchor:this.activeCell,focus:this.activeCell}:null}hasEditableCellsInRange(e){return Jc(this.presentedRows,this.boundsForRange(e))}shouldShowFillHandleForCell(e,i){if(this.focusMode!=="cell")return!1;let r=this.currentFillSourceRange();if(!r)return!1;let o=this.visualSelectionBounds()??this.boundsForRange(r),s=o?this.locationForIndices(o.rowEnd,o.columnEnd):null;return!s||s.rowId!==e||s.columnId!==i?!1:this.hasEditableCellsInRange(r)}currentFillSourceBounds(){return this.currentFillSourceRange()?this.boundsForRange(this.currentFillSourceRange()):null}boundsForRange(e){if(!e)return null;let i=this.cellIndicesFor(e.anchor),r=this.cellIndicesFor(e.focus);return!i||!r?null:{rowStart:Math.min(i.rowIndex,r.rowIndex),rowEnd:Math.max(i.rowIndex,r.rowIndex),columnStart:Math.min(i.columnIndex,r.columnIndex),columnEnd:Math.max(i.columnIndex,r.columnIndex)}}rangeFromBounds(e){return yd(this.presentedRows,this.presentedColumns,e)}locationForIndices(e,i){return Vr(this.presentedRows,this.presentedColumns,e,i)}beginFillDrag(e){let i=this.currentFillSourceRange();if(!i||!this.hasEditableCellsInRange(i))return;let r=dd(e.pointerId,i);if(!r)return;let o=this.getScrollContainer();this.#l=r,this.fillPreview=null,o?.focus({preventScroll:!0});try{o?.setPointerCapture(e.pointerId)}catch{}e.preventDefault()}handleFillPointerMove(e){let i=this.#l.sourceRange;if(!i)return;let r=this.boundsForRange(i),o=this.fillTargetLocationForPoint(e.clientX,e.clientY,r);this.fillPreview=o?this.fillPreviewRangeForLocation(o,i):null}handleFillPointerUp(){let e=this.fillDetailForPreview(),i=e?.target??this.fillPreview;e&&this.$emit("cell-fill",e),this.endFillDrag(!0),i&&(this.cellSelection=this.createCellSelection(i.anchor,i.focus))}endFillDrag(e){let i=this.getScrollContainer();if(i&&this.#l.pointerId!==null&&i.hasPointerCapture?.(this.#l.pointerId))try{i.releasePointerCapture(this.#l.pointerId)}catch{}this.#o=e,this.#l=pn(),this.fillPreview=null}fillPreviewRangeForLocation(e,i){let r=this.boundsForRange(i),o=this.cellIndicesFor(e);if(!r||!o)return null;let s={rowStart:Math.min(r.rowStart,o.rowIndex),rowEnd:Math.max(r.rowEnd,o.rowIndex),columnStart:Math.min(r.columnStart,o.columnIndex),columnEnd:Math.max(r.columnEnd,o.columnIndex)},n=this.clampFillBoundsToEditableTargets(s,r);return n.rowStart===r.rowStart&&n.rowEnd===r.rowEnd&&n.columnStart===r.columnStart&&n.columnEnd===r.columnEnd?null:this.rangeFromBounds(n)}clampFillBoundsToEditableTargets(e,i){return Zc(this.presentedRows,e,i)}fillTargetLocationForPoint(e,i,r){let o=this.locationFromPointerEventLike(e,i);if(o&&(!r||!this.locationWithinBounds(o,r)))return o;let s=r?this.fillPreferredAxisForPoint(e,i,r):null;if(s){let n=this.nearestLocationForPoint(e,i,a=>{if(r&&this.locationWithinBounds(a,r))return!1;let l=this.cellIndicesFor(a);return!l||!r?!0:s==="horizontal"?l.rowIndex>=r.rowStart&&l.rowIndex<=r.rowEnd:l.columnIndex>=r.columnStart&&l.columnIndex<=r.columnEnd});if(n)return n}return this.nearestLocationForPoint(e,i,n=>r?!this.locationWithinBounds(n,r):!0)}fillPreferredAxisForPoint(e,i,r){return rd(e,i,this.rectForBounds(r))}rectForBounds(e){let i=this.locationForIndices(e.rowStart,e.columnStart),r=this.locationForIndices(e.rowEnd,e.columnEnd),o=this.cellElementForLocation(i),s=this.cellElementForLocation(r);return od(o,s)}fillDetailForPreview(){let e=this.#l.sourceRange,i=this.fillPreview;return!e||!i?null:this.fillDetailFor(e,i)}fillDetailFor(e,i){let r=this.boundsForRange(e),o=this.boundsForRange(i);if(!r||!o)return null;let s=td({rows:this.presentedRows,columns:this.presentedColumns,sourceBounds:r,targetBounds:o,normalizeValue:(n,a)=>this.normalizedEditingValue(n,a)});return s.length?{source:e,target:i,changes:s}:null}presentedCellAt(e){if(!e)return null;let i=this.#m.get(e.rowId),r=this.#v.get(e.columnId);return i===void 0||r===void 0?null:this.presentedRows[i]?.cells[r]??null}editStringForCell(e){return Id(e.rawValue)}normalizedEditingValue(e,i){return yn(e,i)}booleanCellValue(e){return Lo(e)}nextTabCellLocation(e,i){return wd(this.presentedRows,this.presentedColumns,e,i)}cellIndicesFor(e){let i=this.#m.get(e.rowId),r=this.#v.get(e.columnId);return i===void 0||r===void 0?null:{rowIndex:i,columnIndex:r}}isEditingCell(e,i){return this.editingCell?.rowId===e&&this.editingCell?.columnId===i}isEditorElement(e){return Ed(e)}editorValueFromTarget(e){return Kc(e)}isInteractiveCellWidgetTarget(e){return bn(e)}commitCheckboxCellToggle(e,i){let r=this.presentedCellAt(e);!r?.editable||r.editor!=="checkbox"||this.$emit("cell-change",{rowId:e.rowId,columnId:e.columnId,value:this.normalizedEditingValue(r,i)})}isFillHandleTarget(e){return Td(e)}closestFromEventPath(e,i){return un(e,i)}isEditorEvent(e){return this.closestFromEventPath(e,".cell-editor")!==null}isInteractiveCellWidgetEvent(e){return e.composedPath().some(i=>bn(i))}isFillHandleEvent(e){return this.closestFromEventPath(e,'[data-fill-handle="true"]')!==null}isActiveCell(e,i){return this.activeCell?.rowId===e&&this.activeCell?.columnId===i}locationFromTarget(e){let i=this.cellElementFromTarget(e);return i?this.locationFromCellElement(i):null}locationFromEvent(e){let i=Xc(e);return i?this.locationFromCellElement(i):null}cellElementFromTarget(e){return Yc(e)}locationFromPointerEvent(e){let i=this.locationFromPointerEventLike(e.clientX,e.clientY);if(i)return i;let r=this.locationFromTarget(e.target);return r||this.nearestLocationForPoint(e.clientX,e.clientY)}locationFromMouseEvent(e){let i=this.locationFromPointerEventLike(e.clientX,e.clientY);return i||this.nearestLocationForPoint(e.clientX,e.clientY)}locationFromPointerEventLike(e,i){let r=this.shadowRoot?.elementFromPoint(e,i);return this.locationFromTarget(r??null)}nearestLocationForPoint(e,i,r){let o=Array.from(this.shadowRoot?.querySelectorAll("td[data-row-id][data-column-id]")??[]);return id({cells:o,clientX:e,clientY:i,predicate:r})}locationWithinBounds(e,i){let r=this.#m.get(e.rowId),o=this.#v.get(e.columnId);return r!==void 0&&o!==void 0&&r>=i.rowStart&&r<=i.rowEnd&&o>=i.columnStart&&o<=i.columnEnd}locationFromCellElement(e){return Ro(e)}cellElementForLocation(e){if(!e)return null;let i=CSS.escape(e.rowId),r=CSS.escape(e.columnId);return this.shadowRoot?.querySelector(`td[data-row-id="${i}"][data-column-id="${r}"]`)}endPointerSelection(e){let i=this.getScrollContainer(),r=this.#s;if(i&&r.pointerId!==null&&i.hasPointerCapture?.(r.pointerId))try{i.releasePointerCapture(r.pointerId)}catch{}this.#o=cd(r,e),this.#s=hn()}cellIdFor(e,i){return`${this.localName}-cell-${this.instanceId}-${this.sanitizeForId(e)}-${this.sanitizeForId(i)}`}cellEditorErrorIdFor(e,i){return`${this.cellIdFor(e,i)}-edit-error`}cellEditorHintIdFor(e,i){return`${this.cellIdFor(e,i)}-edit-hint`}columnAccessoryText(e,i,r){let o=this.presentedColumns[this.#v.get(e)??-1]?.source;if(!o||i===void 0)return"";let s=o[r]?.(i);return typeof s=="string"?s.trim():""}getActiveCellElement(){return this.activeCell?this.shadowRoot?.getElementById(this.cellIdFor(this.activeCell.rowId,this.activeCell.columnId)):null}getActiveEditorElement(){if(!this.editingCell)return null;let e=CSS.escape(this.editingCell.rowId),i=CSS.escape(this.editingCell.columnId);return this.shadowRoot?.querySelector(`.cell-editor[data-row-id="${e}"][data-column-id="${i}"]`)}sanitizeForId(e){return Array.from(e,i=>/[a-zA-Z0-9]/.test(i)?i:`_${i.codePointAt(0)?.toString(16)}_`).join("")}syncHostStates(){this.toggleState("busy",this.busy),this.toggleState("sticky-header",this.stickyHeader),this.toggleState("virtualize",this.virtualize),this.toggleState("empty",!(this.presentedRows?.length??0)),this.#e.ariaBusy=this.busy?"true":"false"}syncRenderedRows(){if(!Array.isArray(this.presentedRows)||!Array.isArray(this.presentedColumns))return;let e=this.focusedSelectionControl(),i=this.virtualize?this.#t.getVirtualItems():[],r=this.virtualize?this.#t.getTotalSize():0,o=Fd({virtualize:this.virtualize,rows:this.presentedRows,estimatedRowHeight:this.estimatedRowHeight,virtualItems:i,totalSize:r}),s=new Set(o.renderedRows.map(p=>p.item.index)),n=this.#S;if(this.recycleFocusedRowIfNeeded(s),this.#S!==n){this.syncRenderedRows();return}let a=this.interactionSnapshot();this.virtualTotalSize=r;let d=this.#B===this.#S&&this.#C===this.#_?new Map(this.renderedRows.map(p=>[p.item.index,p])):new Map,h=o.renderedRows.map(p=>{let x=this.withInteractionState(p.row,p.item.index,a),k=d.get(p.item.index);return k?.row===x?(k.item=p.item,k):{item:p.item,row:x}});if((h.length!==this.renderedRows.length||h.some((p,x)=>p!==this.renderedRows[x]))&&this.renderedRows.splice(0,this.renderedRows.length,...h),this.#B=this.#S,this.#C=this.#_,this.focusMode==="cell"){let p=new Set(o.renderedRows.map(x=>x.row.id));for(let x of this.#F.keys())p.has(x)||this.#F.delete(x)}else this.#F.clear();this.virtualPaddingStart=o.virtualPaddingStart,this.virtualPaddingEnd=o.virtualPaddingEnd,this.scheduleRenderedRowMeasurement(),this.restoreSelectionControlFocus(e)}focusedSelectionControl(){let e=this.shadowRoot?.activeElement;if(!(e instanceof HTMLElement))return null;let i=e.matches("violet-radio.selection-radio")?"violet-radio.selection-radio":e.matches("violet-checkbox.selection-checkbox")?"violet-checkbox.selection-checkbox":null,r=i?this.selectionControlRowId(e):void 0;return i&&r?{element:e,focusGeneration:this.#L,rowId:r,selector:i}:null}selectionControlRowId(e){return e?.closest("tr[data-row-index]")?.querySelector("td[data-row-id]")?.getAttribute("data-row-id")??void 0}restoreSelectionControlFocus(e){if(!e)return;let i=++this.#D;K.enqueue(()=>{if(i!==this.#D||!this.$fastController.isConnected)return;let r=this.shadowRoot?.activeElement;if(r&&r!==e.element)return;let o=this.ownerDocument.activeElement;if(!r&&o&&o!==this.ownerDocument.body&&o!==this||r===e.element&&this.selectionControlRowId(r)===e.rowId||this.#L!==e.focusGeneration)return;Array.from(this.shadowRoot?.querySelectorAll(e.selector)??[]).find(n=>this.selectionControlRowId(n)===e.rowId)?.focus({preventScroll:!0})})}#O;interactionSnapshot(){return{selectionBounds:this.visualSelectionBounds(),fillPreviewBounds:this.fillPreview?this.boundsForRange(this.fillPreview):null,fillSourceBounds:this.#l.sourceRange?this.boundsForRange(this.#l.sourceRange):this.currentFillSourceBounds()}}scheduleRenderedRowMeasurement(){!this.virtualize||!this.$fastController.isConnected||(this.#n!==null&&cancelAnimationFrame(this.#n),this.#n=requestAnimationFrame(()=>{if(this.#n=null,!this.$fastController.isConnected)return;this.#t.measureElement(null),this.shadowRoot?.querySelectorAll("tbody tr[data-index]")?.forEach(i=>{this.#t.measureElement(i)})}))}recycleFocusedRowIfNeeded(e){if(!this.virtualize||this.#$||e.size===0&&this.presentedRows.length>0)return;let i=this.editingCell?this.#m.get(this.editingCell.rowId):void 0,o=this.shadowRoot?.activeElement?.closest?.("tr[data-row-index]"),s=o?Number.parseInt(o.dataset.rowIndex??"",10):Number.NaN,n=Number.isFinite(s)&&!e.has(s);if(i!==void 0&&!e.has(i)){this.#$=!0;let a=this.editingCell,l=a?this.presentedCellAt(a):null,d=this.#g?.id;if(!this.commitEditingCell()&&d&&this.#g?.id===d){let p=l?.columnLabel??a?.columnId??"cell";this.editAnnouncement=`Unsaved invalid edit in ${p} was cancelled because its row left the visible grid.`,this.cancelActiveEdit()}this.#$=!1,n=!0}n&&(this.#I!==null&&cancelAnimationFrame(this.#I),this.#I=requestAnimationFrame(()=>{this.#I=null,this.editingCell||this.getScrollContainer()?.focus({preventScroll:!0})}))}scheduleVirtualizerUpdate(){this.$fastController.isConnected&&(this.#r!==null&&cancelAnimationFrame(this.#r),this.#r=requestAnimationFrame(()=>{this.#r=null,this.#t.setOptions({...this.#t.options,...Dd({rows:this.presentedRows,estimatedRowHeight:this.estimatedRowHeight,overscanCount:this.overscanCount,virtualize:this.virtualize})}),this.#t._willUpdate(),this.#t.measure(),this.syncRenderedRows()}))}getScrollContainer(){return this.shadowRoot?.querySelector(".table-scroll")}rowHeightForDensity(e){switch(e){case"compact":return 24;case"comfortable":return 44;default:return 32}}toggleState(e,i){if(i){this.#e.states.add(e);return}this.#e.states.delete(e)}mergePartNames(e,i){return i?`${e} ${i}`:e}},Om=0;c({attribute:"selection-mode"})(N.prototype,"selectionMode");c({attribute:"selection-label"})(N.prototype,"selectionLabel");c({attribute:"sticky-header",mode:"boolean"})(N.prototype,"stickyHeader");c({mode:"boolean"})(N.prototype,"busy");c({mode:"boolean"})(N.prototype,"virtualize");c({attribute:"show-filter",mode:"boolean"})(N.prototype,"showFilter");c(N.prototype,"density");c({attribute:"focus-mode"})(N.prototype,"focusMode");c({attribute:"sort-mode"})(N.prototype,"sortMode");m(N.prototype,"columns");m(N.prototype,"columnWidths");m(N.prototype,"rows");m(N.prototype,"sort");m(N.prototype,"filterState");m(N.prototype,"selectedRowIds");m(N.prototype,"presentedColumns");m(N.prototype,"presentedRows");m(N.prototype,"renderedRows");m(N.prototype,"activeCell");m(N.prototype,"cellSelection");m(N.prototype,"editingCell");m(N.prototype,"editingValue");m(N.prototype,"editingError");m(N.prototype,"editAnnouncement");m(N.prototype,"fillPreview");m(N.prototype,"estimatedRowHeight");m(N.prototype,"overscanCount");m(N.prototype,"virtualPaddingStart");m(N.prototype,"virtualPaddingEnd");m(N.prototype,"virtualTotalSize");m(N.prototype,"hasToolbarSlotContent");m(N.prototype,"headerFocusColumnId");customElements.get("violet-data-grid")||await f.define(N,{name:"violet-data-grid",template:Mm,styles:Ec,shadowOptions:{delegatesFocus:!0}});var Lm=v`
    ${F}

    :host {
        display: grid;
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
        --_upload-surface: var(--_surface-page);
        --_upload-surface-hover: color-mix(in srgb, var(--_surface-page) 76%, var(--_surface-subtle));
        --_upload-surface-active: color-mix(in srgb, var(--_focus-ring) 10%, var(--_surface-page));
        --_upload-border: var(--_border-subtle);
        --_upload-gap: var(--_space-stack-sm);
        --_upload-radius: calc(var(--_radius-md) * 1.5);
        --_upload-space-2xs: var(--_space-stack-2xs);
        --_upload-space-sm: var(--_space-inline-sm);
        --_upload-space-md: calc(var(--_space-inline-md) * 1.5);
        --_upload-space-lg: calc(var(--_space-inline-md) * 2.5);
        --_upload-stack-md: calc(var(--_space-stack-sm) * 1.5);
        --_upload-stack-lg: calc(var(--_space-stack-sm) * 2);
        --_upload-padding: clamp(var(--_upload-space-md), 2vw, var(--_upload-space-lg));
        --_upload-title-size: var(--_control-body-size);
        --_upload-summary-size: var(--_control-caption-size);
        --_upload-icon-size: max(1rem, calc(var(--_target-size) * 0.4));
        color: var(--color-text-primary, #18181b);
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
    }

    .field {
        display: grid;
        gap: var(--_space-stack-sm);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin: 0;
    }

    .surface {
        box-sizing: border-box;
        display: grid;
        gap: var(--_upload-stack-md);
        inline-size: 100%;
        padding: var(--_upload-padding);
        border: 1px solid var(--_upload-border);
        border-radius: var(--_upload-radius);
        background: var(--_upload-surface);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .surface:hover {
        border-color: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
        background: var(--_upload-surface-hover);
    }

    .surface:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([invalid]) .surface,
    :host([data-invalid]) .surface {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .surface,
    :host(:disabled) .surface {
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    .surface.dropzone {
        min-block-size: calc(var(--_target-size) * 4.15);
        border-style: dashed;
        align-content: center;
        justify-items: stretch;
        padding: max(var(--_upload-space-lg), calc(var(--_target-size) * 0.5));
    }

    :host([data-drag-active]) .surface.dropzone {
        border-color: color-mix(in srgb, var(--_focus-ring) 70%, var(--_border-subtle));
        background: var(--_upload-surface-active);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 42%, transparent);
    }

    .button-layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: var(--_upload-space-lg);
        min-block-size: calc(var(--_target-size) * 1.45);
    }

    .dropzone-layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: var(--_upload-space-lg);
        row-gap: var(--_upload-stack-md);
        align-items: start;
        min-inline-size: 0;
        min-block-size: 100%;
    }

    .browse-button {
        align-self: center;
    }

    .browse-button::part(control) {
        min-inline-size: max-content;
    }

    .button-copy {
        align-content: center;
        min-inline-size: 0;
    }

    .dropzone-copy,
    .button-copy,
    .selection,
    .file-copy {
        display: grid;
        min-inline-size: 0;
    }

    .leading-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_target-size) * 0.95);
        block-size: calc(var(--_target-size) * 0.95);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: color-mix(in srgb, var(--_focus-ring) 10%, var(--_surface-subtle));
        color: var(--_text-secondary);
        flex: 0 0 auto;
    }

    .leading-icon violet-icon {
        --violet-icon-size: var(--_upload-icon-size);
        color: currentColor;
    }

    .trigger-copy,
    .dropzone-title {
        margin: 0;
        color: var(--color-text-primary, #18181b);
        font-size: var(--_upload-title-size);
        line-height: 1.25;
        font-weight: 600;
    }

    .summary,
    .dropzone-message,
    .selection-summary,
    .meta,
    .supporting,
    .error {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_upload-summary-size);
        line-height: var(--_type-caption-line);
    }

    .button-copy {
        gap: var(--_space-stack-2xs);
    }

    .dropzone-copy {
        gap: var(--_space-stack-xs);
        align-content: start;
        max-inline-size: 34rem;
        padding-block-start: var(--_upload-space-2xs);
    }

    .dropzone-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_upload-space-md);
        grid-column: 2;
    }

    .native-input {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    .selection {
        gap: var(--_space-stack-xs);
    }

    .selection[hidden],
    .supporting[hidden],
    .error[hidden] {
        display: none;
    }

    .file-list {
        display: grid;
        gap: var(--_upload-stack-md);
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .file-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--_upload-space-md);
        padding: var(--_upload-space-md) var(--_upload-space-lg);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: color-mix(in srgb, var(--_surface-subtle) 45%, var(--_surface-page));
        box-shadow: var(--_shadow-control);
    }

    .file-item-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_target-size) * 0.8);
        block-size: calc(var(--_target-size) * 0.8);
        border-radius: calc(var(--_radius-md) * 1.15);
        background: color-mix(in srgb, var(--_focus-ring) 8%, var(--_surface-page));
        color: var(--_text-secondary);
    }

    .file-item-icon violet-icon {
        --violet-icon-size: var(--_upload-icon-size);
        color: currentColor;
    }

    .file-copy {
        gap: 2px;
    }

    .filename {
        margin: 0;
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .remove-button {
        align-self: center;
    }

    @media (max-width: 40rem) {
        .button-layout,
        .dropzone-layout {
            grid-template-columns: minmax(0, 1fr);
        }

        .dropzone-actions {
            grid-column: auto;
        }

        .button-copy,
        .dropzone-copy {
            max-inline-size: none;
        }
    }

    .error {
        color: var(--color-state-danger-text, #b42318);
    }

    @media (forced-colors: active) {
        .surface,
        .file-item {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }

        :host([drag-active]) .surface.dropzone {
            background: Canvas;
            outline: 2px solid Highlight;
        }

        .leading-icon,
        .file-item-icon {
            background: Canvas;
            color: ButtonText;
        }

        .error {
            color: LinkText;
        }
    }
`,Vm=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <p class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</p>
            `)}

        <input
            id="${t=>t.inputId}"
            class="native-input"
            part="native-input"
            type="file"
            tabindex="-1"
            aria-hidden="true"
            accept="${t=>t.accept}"
            name="${t=>t.name}"
            :value="${t=>t.value}"
            ?multiple="${t=>t.multiple}"
            ?disabled="${t=>t.effectiveDisabled}"
            ?required="${t=>t.required}"
            aria-invalid="${t=>t.invalid?"true":"false"}"
            @input="${(t,e)=>t.handleInput(e.event)}"
            @change="${(t,e)=>t.handleCommit(e.event)}"
        />

        <div
            class="${t=>`surface ${t.appearance}`}"
            part="surface"
            role="group"
            aria-labelledby="${t=>t.label?t.labelId:null}"
            aria-describedby="${t=>t.describedBy||null}"
            @dragenter="${(t,e)=>t.handleDragEnter(e.event)}"
            @dragover="${(t,e)=>t.handleDragOver(e.event)}"
            @dragleave="${(t,e)=>t.handleDragLeave(e.event)}"
            @drop="${(t,e)=>t.handleDrop(e.event)}"
            @click="${(t,e)=>t.handleSurfaceClick(e.event)}"
        >
            ${b(t=>t.appearance==="button",u`
                    <div class="button-layout" part="button-layout">
                        <violet-button
                            class="browse-button"
                            part="browse-button"
                            appearance="secondary"
                            :ariaLabel="${t=>t.triggerAriaLabel}"
                            :ariaDescribedby="${t=>t.describedBy}"
                            :ariaErrormessage="${t=>t.errorMessageId}"
                            ?disabled="${t=>t.effectiveDisabled}"
                            @click="${(t,e)=>t.handleBrowseButtonClick(e.event)}"
                        >
                            <violet-icon slot="before" icon="system/attach" decorative></violet-icon>
                            ${t=>t.browseButtonLabel}
                        </violet-button>
                        <div class="button-copy" part="button-copy">
                            <p class="trigger-copy" part="trigger-copy">${t=>t.buttonTitle}</p>
                            <p class="summary" part="summary" id="${t=>t.summaryId}" role="status" aria-live="polite">${t=>t.summaryText}</p>
                        </div>
                    </div>
                `)}

            ${b(t=>t.appearance==="dropzone",u`
                    <div class="dropzone-layout" part="dropzone-layout">
                        <span class="leading-icon" part="leading-icon">
                            <violet-icon icon="system/attach" decorative></violet-icon>
                        </span>
                        <div class="dropzone-copy" part="dropzone-copy">
                            <p class="dropzone-title" part="dropzone-title">${t=>t.dropzoneTitle}</p>
                            <p class="dropzone-message" part="dropzone-message" id="${t=>t.summaryId}" role="status" aria-live="polite">${t=>t.dropzoneMessage}</p>
                        </div>
                        <div class="dropzone-actions" part="dropzone-actions">
                            <violet-button
                                class="browse-button"
                                part="browse-button"
                                appearance="secondary"
                                :ariaLabel="${t=>t.triggerAriaLabel}"
                                :ariaDescribedby="${t=>t.describedBy}"
                                :ariaErrormessage="${t=>t.errorMessageId}"
                                ?disabled="${t=>t.effectiveDisabled}"
                                @click="${(t,e)=>t.handleBrowseButtonClick(e.event)}"
                            >
                                ${t=>t.browseButtonLabel}
                            </violet-button>
                        </div>
                    </div>
                `)}
        </div>

        <div class="selection" part="selection" ?hidden="${t=>!t.hasFiles}">
            <p class="selection-summary" part="selection-summary">${t=>t.selectionSummaryText}</p>
            <ul class="file-list" part="file-list">
                ${L(t=>t.fileItems,u`
                        <li class="file-item" part="file-item">
                            <span class="file-item-icon" part="file-icon">
                                <violet-icon icon="system/document" decorative></violet-icon>
                            </span>
                            <div class="file-copy" part="file-copy">
                                <p class="filename" part="filename" title="${t=>t.file.name}">${t=>t.file.name}</p>
                                <p class="meta" part="file-meta">${t=>t.meta}</p>
                            </div>
                            <violet-icon-button
                                class="remove-button"
                                part="remove-button"
                                appearance="transparent"
                                label="${t=>`Remove ${t.file.name}`}"
                                @click="${(t,e)=>e.parent.removeFileAt(t.index)}"
                            >
                                <violet-icon icon="system/dismiss" decorative></violet-icon>
                            </violet-icon-button>
                        </li>
                    `,{positioning:!0})}
            </ul>
        </div>

        <p class="supporting" part="supporting-text" id="${t=>t.supportingId}" ?hidden="${t=>!t.showSupportingText}">
            ${t=>t.supportingText}
        </p>
        <p class="error" part="error-text" id="${t=>t.errorId}" ?hidden="${t=>!t.showErrorText}">
            ${t=>t.effectiveErrorText}
        </p>
    </div>
`,Vi=0,ee=class extends f{static{this.formAssociated=!0}#e;#t;#i;#r;constructor(){super(),this.#e=this.attachInternals(),Vi+=1,this.inputId=`violet-file-upload-input-${Vi}`,this.labelId=`violet-file-upload-label-${Vi}`,this.supportingId=`violet-file-upload-supporting-${Vi}`,this.errorId=`violet-file-upload-error-${Vi}`,this.summaryId=`violet-file-upload-summary-${Vi}`,this.#t=[],this.#i=0,this.#r="",this.label="",this.supportingText="",this.errorText="",this.dragActive=!1,this.files=[],this.customValidationMessage="",this.appearance="button",this.size="natural",this.accept="",this.name="",this.disabled=!1,this.required=!1,this.invalid=!1,this.multiple=!1,this.maxFiles="",this.maxFileSize="",fr(),vt(),Ae()}connectedCallback(){super.connectedCallback(),this.#t=[...this.files],this.#h(),this.#p()}filesChanged(){this.#h(),this.#p()}disabledChanged(){this.#h(),this.#p()}requiredChanged(){this.#p()}invalidChanged(){this.#h(),this.#p()}customValidationMessageChanged(){this.#h(),this.#p()}multipleChanged(){if(!this.multiple&&this.files.length>1){this.files=this.files.slice(0,1);return}this.#p()}formResetCallback(){this.files=[...this.#t],this.customValidationMessage="",this.dragActive=!1,this.#r="",this.#v()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get value(){return""}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}setFiles(e){let i=[...e],r=this.#l(i);return r?(this.customValidationMessage=r,!1):(this.customValidationMessage="",this.#r=this.#a(i),this.files=i,this.#v(),this.$emit("input",{files:[...this.files]}),this.$emit("change",{files:[...this.files]}),!0)}clearFiles(){this.files=[],this.customValidationMessage="",this.#r="",this.#v(),this.$emit("input",{files:[]}),this.$emit("change",{files:[]})}removeFileAt(e){let i=this.files[e];i&&(this.files=this.files.filter((r,o)=>o!==e),this.customValidationMessage="",this.#r=this.#a(this.files),this.#v(),this.$emit("remove",{file:i,index:e,files:[...this.files]}),this.$emit("input",{files:[...this.files]}),this.$emit("change",{files:[...this.files]}))}handleInput(e){e.stopPropagation();let i=e.currentTarget,r=Array.from(i?.files??[]);this.#r=this.#a(r)}handleCommit(e){e.stopPropagation(),this.handleInputChange(e)}handleBrowseButtonClick(e){e.preventDefault(),e.stopPropagation(),this.openPicker()}handleSurfaceClick(e){if(this.effectiveDisabled||this.appearance!=="dropzone")return;e.composedPath().some(o=>o instanceof HTMLElement?o.tagName==="BUTTON"||o.tagName==="VIOLET-BUTTON"||o.tagName==="VIOLET-ICON-BUTTON":!1)||this.openPicker()}handleInputChange(e){let i=e.currentTarget,r=Array.from(i?.files??[]);this.#n(r)}handleDragEnter(e){this.#m(e)&&(e.preventDefault(),this.#i+=1,this.dragActive=!0)}handleDragOver(e){this.#m(e)&&(e.preventDefault(),e.dataTransfer&&(e.dataTransfer.dropEffect="copy"),this.dragActive=!0)}handleDragLeave(e){this.appearance!=="dropzone"||this.effectiveDisabled||(e.preventDefault(),this.#i=Math.max(0,this.#i-1),this.#i===0&&(this.dragActive=!1))}handleDrop(e){if(!this.#m(e))return;e.preventDefault(),this.dragActive=!1,this.#i=0;let i=Array.from(e.dataTransfer?.files??[]);this.#n(i)}openPicker(){if(this.effectiveDisabled)return;this.shadowRoot?.getElementById(this.inputId)?.click()}get hasFiles(){return R.trackVolatile(),this.files.length>0}get fileItems(){return R.trackVolatile(),this.files.map((e,i)=>({file:e,index:i,key:`${e.name}:${e.size}:${e.lastModified}:${e.type}:${i}`,meta:this.formatFileMeta(e)}))}get browseButtonLabel(){return R.trackVolatile(),!this.multiple&&this.hasFiles?"Replace file":this.multiple?"Browse files":"Browse file"}get buttonTitle(){return R.trackVolatile(),this.hasFiles?this.multiple?"Add or replace selected files":"Replace the selected file":this.multiple?"Select files to upload":"Select a file to upload"}get summaryText(){return R.trackVolatile(),this.hasFiles?this.files.length===1?this.files[0].name:`${this.files.length} files selected`:this.multiple?"No files selected yet.":"No file selected yet."}get dropzoneTitle(){return R.trackVolatile(),this.dragActive?this.multiple?"Drop files to add them":"Drop a file to select it":this.multiple?"Drop files here":"Drop a file here"}get dropzoneMessage(){return R.trackVolatile(),this.hasFiles?this.summaryText:this.multiple?"Or browse from your device to select multiple files.":"Or browse from your device to select one file."}get selectionSummaryText(){return R.trackVolatile(),this.hasFiles?this.files.length===1?"Selected file":`${this.files.length} selected files`:""}get triggerAriaLabel(){return R.trackVolatile(),this.label?`${this.label}: ${this.browseButtonLabel}`:this.browseButtonLabel}get describedBy(){R.trackVolatile();let e=[this.summaryId];return this.showErrorText?e.push(this.errorId):this.supportingText&&e.push(this.supportingId),e.join(" ")||null}get errorMessageId(){return R.trackVolatile(),this.showErrorText?this.errorId:null}get effectiveErrorText(){return R.trackVolatile(),this.customValidationMessage?this.customValidationMessage:this.invalid?this.errorText||"There is a problem with the selected file.":""}get showErrorText(){return R.trackVolatile(),!!this.effectiveErrorText}get showSupportingText(){return R.trackVolatile(),!!this.supportingText&&!this.showErrorText}formatFileMeta(e){let i=[this.#f(e.size)];return e.type&&i.push(e.type),i.join(" \u2022 ")}#n(e){let i=this.#a(e);if(i===this.#r&&i===this.#a(this.files))return;this.#r=i;let r=this.multiple?this.#s(this.files,e):e.slice(0,1);this.setFiles(r)}#s(e,i){let r=[...e],o=new Set(e.map(s=>this.#o(s)));for(let s of i){let n=this.#o(s);o.has(n)||(o.add(n),r.push(s))}return r}#o(e){return`${e.name}:${e.size}:${e.type}:${e.lastModified}`}#a(e){return e.map(i=>this.#o(i)).join("|")}#l(e){if(!this.multiple&&e.length>1)return"Only one file can be selected.";let i=this.#d;if(i>0&&e.length>i)return i===1?"Only one file can be selected.":`Select no more than ${i} files.`;let r=this.#u;if(r>0){let o=e.find(s=>s.size>r);if(o)return`${o.name} exceeds the ${this.#f(r)} limit.`}if(this.accept.trim()){let o=e.find(s=>!this.#c(s));if(o)return`${o.name} does not match the accepted file types.`}return""}#c(e){let i=this.accept.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);if(i.length===0)return!0;let r=e.name.toLowerCase(),o=e.type.toLowerCase();return i.some(s=>{if(s.startsWith("."))return r.endsWith(s);if(s.endsWith("/*")){let n=s.slice(0,-1);return o.startsWith(n)}return o===s})}get#d(){let e=Number.parseInt(this.maxFiles,10);return Number.isFinite(e)&&e>0?e:0}get#u(){let e=Number.parseInt(this.maxFileSize,10);return Number.isFinite(e)&&e>0?e:0}#h(){this.toggleAttribute("data-invalid",this.invalid||!!this.customValidationMessage),this.toggleAttribute("data-drag-active",this.dragActive)}#p(){if(!this.$fastController.isConnected)return;let e=this.files??[],i=this.required&&e.length===0,r=!!this.customValidationMessage||this.invalid,o=this.customValidationMessage||(this.invalid?this.errorText||"Invalid file selection.":"")||(i?"Select a file to continue.":""),s=this.shadowRoot?.querySelector("input");if(this.#e.ariaInvalid=this.invalid||this.customValidationMessage?"true":"false",this.#e.setValidity({valueMissing:i,customError:r},o||void 0,s??void 0),this.effectiveDisabled||e.length===0||!this.name){this.#e.setFormValue(null);return}let n=new FormData;for(let a of e)n.append(this.name,a);this.#e.setFormValue(n)}#f(e){return e<1024?`${e} B`:e<1024*1024?`${Math.round(e/102.4)/10} KB`:`${Math.round(e/104857.6)/10} MB`}#m(e){if(this.appearance!=="dropzone"||this.effectiveDisabled)return!1;let i=e.dataTransfer?.types;return i?Array.from(i).includes("Files"):!0}#v(){let e=this.shadowRoot?.getElementById(this.inputId);e&&(e.value="")}};c(ee.prototype,"label");c({attribute:"supporting-text"})(ee.prototype,"supportingText");c({attribute:"error-text"})(ee.prototype,"errorText");c(ee.prototype,"appearance");c(ee.prototype,"size");c(ee.prototype,"accept");c(ee.prototype,"name");c({mode:"boolean"})(ee.prototype,"disabled");q(ee.prototype);c({mode:"boolean"})(ee.prototype,"required");c({mode:"boolean"})(ee.prototype,"invalid");c({mode:"boolean"})(ee.prototype,"multiple");c({attribute:"max-files"})(ee.prototype,"maxFiles");c({attribute:"max-file-size"})(ee.prototype,"maxFileSize");m(ee.prototype,"files");m(ee.prototype,"customValidationMessage");m(ee.prototype,"dragActive");customElements.get("violet-file-upload")||await f.define(ee,{name:"violet-file-upload",template:Vm,styles:Lm});var Pm=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Bm=v`
    ${E}

    :host {
        display: block;
        --_image-background: var(--violet-image-background, var(--_surface-subtle));
        --_image-border: var(--violet-image-border, var(--_border-subtle));
        --_image-radius: var(--violet-image-radius, var(--_radius-lg));
        --_image-fit: var(--violet-image-fit, cover);
        --_image-ratio: auto;
    }

    :host([shape="square"]) {
        --_image-radius: var(--_radius-sm);
    }

    :host([shape="rounded"]) {
        --_image-radius: var(--_radius-lg);
    }

    :host([shape="circle"]) {
        --_image-radius: var(--_radius-round);
    }

    :host([ratio="square"]) {
        --_image-ratio: 1 / 1;
    }

    :host([ratio="landscape"]) {
        --_image-ratio: 4 / 3;
    }

    :host([ratio="portrait"]) {
        --_image-ratio: 3 / 4;
    }

    :host([ratio="video"]) {
        --_image-ratio: 16 / 9;
    }

    :host([fit="contain"]) {
        --_image-fit: contain;
    }

    :host([fit="fill"]) {
        --_image-fit: fill;
    }

    .root {
        position: relative;
        box-sizing: border-box;
        display: block;
        inline-size: 100%;
        overflow: hidden;
        border: 1px solid var(--_image-border);
        border-radius: var(--_image-radius);
        background: var(--_image-background);
        aspect-ratio: var(--_image-ratio);
    }

    .media,
    .fallback {
        inline-size: 100%;
        block-size: 100%;
    }

    .media {
        display: block;
        object-fit: var(--_image-fit);
        background: var(--_image-background);
    }

    .fallback {
        display: grid;
        place-items: center;
        min-block-size: 6rem;
        color: var(--_text-muted);
        font-size: var(--_caption-size);
        line-height: var(--_caption-line);
        text-align: center;
    }

    .fallback slot::slotted(*) {
        margin: 0;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
        }

        .fallback {
            color: CanvasText;
        }
    }
`,Nm=u`
    <div
        class="root"
        part="root"
        role="${t=>t.accessibleRole}"
        aria-label="${t=>t.accessibleLabel}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
    >
        ${b(t=>!!t.src,u`
                <img
                    class="media"
                    part="image"
                    src="${t=>t.src}"
                    alt="${t=>t.computedAlt}"
                    loading="${t=>t.loading}"
                    decoding="async"
                    ?hidden="${t=>t.imageFailed}"
                    @error="${t=>t.handleImageError()}"
                />
            `)}
        <div class="fallback" part="fallback" ?hidden="${t=>t.showImage}">
            <slot name="fallback">Image unavailable</slot>
        </div>
    </div>
`,Ye=class extends f{constructor(){super(),this.src="",this.alt="",this.fit="cover",this.ratio="auto",this.shape="rounded",this.loading="lazy",this.decorative=!1,this.imageFailed=!1}connectedCallback(){super.connectedCallback(),this.syncVisualState()}srcChanged(){this.imageFailed=!1,this.syncVisualState()}get showImage(){return R.trackVolatile(),!!this.src&&!this.imageFailed}get computedAlt(){return R.trackVolatile(),this.decorative?"":this.alt}get accessibleRole(){return R.trackVolatile(),this.decorative||this.showImage?null:this.alt.trim()?"img":null}get accessibleLabel(){return R.trackVolatile(),this.decorative||this.showImage?null:this.alt.trim()||null}handleImageError(){this.imageFailed=!0,this.syncVisualState()}syncVisualState(){let e=this.shadowRoot?.querySelector(".media"),i=this.shadowRoot?.querySelector(".fallback");e&&(e.hidden=this.imageFailed),i&&(i.hidden=this.showImage)}};Pm([m],Ye.prototype,"imageFailed",void 0);c(Ye.prototype,"src");c(Ye.prototype,"alt");c(Ye.prototype,"fit");c(Ye.prototype,"ratio");c(Ye.prototype,"shape");c(Ye.prototype,"loading");c({mode:"boolean"})(Ye.prototype,"decorative");customElements.get("violet-image")||await f.define(Ye,{name:"violet-image",template:Nm,styles:Bm});var Br=Symbol("ownedPreviewUrl");function Pi(t){let e=new Set,i=[];return t.forEach((r,o)=>{if(!r||typeof r!="object")return;let s=r,n=String(s.label??s.name??"").trim();if(!n)return;let a=String(s.id??n??`attachment-${o+1}`).trim()||`attachment-${o+1}`;if(e.has(a))return;let l=typeof s.previewSrc=="string"?s.previewSrc.trim():"",d=typeof s.meta=="string"?s.meta:"",h=Ld(s);e.add(a),i.push({id:a,label:n,kind:s.kind==="image"?"image":"document",...l?{previewSrc:l}:{},...d?{meta:d}:{},...h&&h===l?{[Br]:h}:{}})}),i}function Vo(t){if(Array.isArray(t))return Pi(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return Pi(i)}catch{}return[]}function Po(t){return JSON.stringify(Pi(t).map(e=>{if(!Bo(e))return e;let{previewSrc:i,...r}=e;return r}))}function Md(t){return t.map(e=>{let i=e.type.startsWith("image/")?"image":"document",r=i==="image"?URL.createObjectURL(e):"";return{id:`${e.name}:${e.size}:${e.lastModified}`,label:e.name,kind:i,previewSrc:r,meta:`${e.type||"File"} \xB7 ${jm(e.size)}`,...r?{[Br]:r}:{}}})}function xn(t){return t.kind==="image"&&!!t.previewSrc}function Bo(t){return Ld(t)}function Od(t){let e=t,i=e[Br];i&&(e.previewSrc===i&&delete e.previewSrc,delete e[Br])}function jm(t){return!Number.isFinite(t)||t<=0?"0 B":t<1024?`${t} B`:t<1024*1024?`${Math.round(t/1024)} KB`:`${(t/(1024*1024)).toFixed(1)} MB`}function Ld(t){if(!t||typeof t!="object")return;let e=t[Br];return typeof e=="string"&&e.trim()?e:void 0}var Hm=0,Vd=2;vt();Ae();function No(t){return t.kind==="image"&&!xn(t)}var qm=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_size-font-md: var(--size-font-md, 14px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.7;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
        border-radius: var(--_radius-md);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: 0.8125rem;
        font-weight: 400;
        line-height: 1.15;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .preview-stack {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
    }

    violet-image.preview-thumb {
        inline-size: 1.625rem;
        block-size: 1.625rem;
        flex: 0 0 auto;
    }

    .preview-thumb-fallback {
        inline-size: 1.625rem;
        block-size: 1.625rem;
    }

    .file-chip,
    .overflow-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--_surface-subtle) 82%, white);
        color: var(--_text-primary);
        box-sizing: border-box;
        white-space: nowrap;
    }

    .overflow-chip {
        color: var(--_text-secondary);
    }

    .chip-label,
    .placeholder,
    .summary {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    violet-icon.file-icon {
        --violet-icon-size: 0.875rem;
        color: var(--_text-secondary);
        flex: 0 0 auto;
    }

    .preview-thumb-fallback,
    .row-thumb-fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 90%, white);
        color: var(--_text-secondary);
    }

    violet-icon.preview-icon {
        --violet-icon-size: 0.9375rem;
        flex: 0 0 auto;
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: fixed;
        inset: unset;
        margin: 0;
        box-sizing: border-box;
        z-index: var(--_layer-popover);
        display: none;
        gap: 0.625rem;
        inline-size: min(22rem, calc(100vw - 16px));
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        min-inline-size: 0;
        padding: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
        color: var(--_text-primary);
    }

    .panel:popover-open {
        display: grid;
    }

    @media (forced-colors: active) {
        .trigger:focus-visible,
        .panel:focus-visible {
            outline: 2px solid Highlight;
        }

        .panel {
            border-color: CanvasText;
        }
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .attachment-list {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
    }

    .attachment-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 88%, transparent);
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 42%, var(--_surface-page));
    }

    .attachment-preview {
        inline-size: 2rem;
        block-size: 2rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 90%, white);
        overflow: hidden;
    }

    violet-image.row-thumb {
        inline-size: 2rem;
        block-size: 2rem;
    }

    .row-thumb-fallback {
        inline-size: 2rem;
        block-size: 2rem;
    }

    .attachment-copy {
        display: grid;
        gap: 2px;
        min-inline-size: 0;
    }

    .attachment-label {
        margin: 0;
        color: var(--_text-primary);
        font-size: var(--_size-font-md);
        line-height: 1.25;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .attachment-meta {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_size-font-sm);
        line-height: 1.25;
    }

    .remove-button {
        align-self: center;
    }

    .add-upload {
        min-inline-size: 0;
    }

    .add-upload::part(label),
    .add-upload::part(selection),
    .add-upload::part(supporting-text),
    .add-upload::part(error-text),
    .add-upload::part(button-copy) {
        display: none;
    }

    .add-upload::part(surface) {
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
    }

    .add-upload::part(button-layout) {
        min-block-size: auto;
    }

    .empty {
        padding: 0.25rem 0.125rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`,Wm=u`
    <div class="root" part="base">
        <span id="trigger-label" hidden>${t=>t.triggerLabel}</span>
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${t=>t.disabled}"
            aria-labelledby="${t=>t.triggerLabelledBy}"
            aria-haspopup="dialog"
            aria-controls="${t=>t.panelId}"
            aria-expanded="${t=>String(t.open)}"
            @click="${t=>(t.handleTriggerClick(),!0)}"
        >
            <span class="selection" id="trigger-value" part="selection" data-empty="${t=>String(t.attachments.length===0)}">
                <span class="preview-stack">
                    ${b(t=>t.attachments.length===0,u`
                            <span class="placeholder">${t=>t.placeholder||"Add attachments"}</span>
                        `)}
                    ${L(t=>t.visibleAttachments,u`
                            ${b((t,e)=>e.parent.isImageItem(t),u`
                                    <violet-image
                                        class="preview-thumb"
                                        decorative
                                        shape="rounded"
                                        ratio="square"
                                        fit="cover"
                                        src="${t=>t.previewSrc??""}"
                                        alt="${t=>t.label}"
                                    >
                                        <violet-icon slot="fallback" class="preview-icon" icon="system/document" decorative></violet-icon>
                                    </violet-image>
                                `)}
                            ${b(t=>No(t),u`
                                    <span class="preview-thumb-fallback" aria-hidden="true">
                                        <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                    </span>
                                `)}
                            ${b((t,e)=>!e.parent.isImageItem(t)&&!No(t),u`
                                    <span class="file-chip">
                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                        <span class="chip-label">${t=>t.label}</span>
                                    </span>
                                `)}
                        `)}
                    ${b(t=>t.overflowCount>0,u`
                            <span class="overflow-chip" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                ${b(t=>t.attachments.length>0,u`
                        <span class="summary">${t=>t.selectionLabel}</span>
                    `)}
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${b(t=>t.open,u`
                <div
                    class="panel"
                    id="${t=>t.panelId}"
                    part="panel"
                    popover="manual"
                    role="dialog"
                    tabindex="-1"
                    aria-label="${t=>t.getAttribute("aria-label")||t.placeholder||"Attachments"}"
                    @toggle="${(t,e)=>(t.handlePanelToggle(e.event),!0)}"
                    @keydown="${(t,e)=>(t.handlePanelKeydown(e.event),!0)}"
                >
                    <div class="selection-summary" part="selection-summary">${t=>t.selectionSummary}</div>
                    ${b(t=>t.attachments.length>0,u`
                            <div class="attachment-list" part="attachment-list">
                                ${L(t=>t.attachments,u`
                                        <div class="attachment-row" part="attachment-row">
                                            <span class="attachment-preview">
                                                ${b((t,e)=>e.parent.isImageItem(t),u`
                                                        <violet-image
                                                            class="row-thumb"
                                                            decorative
                                                            shape="rounded"
                                                            ratio="square"
                                                            fit="cover"
                                                            src="${t=>t.previewSrc??""}"
                                                            alt="${t=>t.label}"
                                                        ></violet-image>
                                                    `)}
                                                ${b(t=>No(t),u`
                                                        <span class="row-thumb-fallback" aria-hidden="true">
                                                            <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                                        </span>
                                                    `)}
                                                ${b((t,e)=>!e.parent.isImageItem(t)&&!No(t),u`
                                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                                    `)}
                                            </span>
                                            <div class="attachment-copy">
                                                <p class="attachment-label" title="${t=>t.label}">${t=>t.label}</p>
                                                <p class="attachment-meta">${t=>t.meta||"Attachment"}</p>
                                            </div>
                                            ${b((t,e)=>!e.parent.readonly,u`
                                                    <violet-icon-button
                                                        class="remove-button"
                                                        part="remove-button"
                                                        appearance="transparent"
                                                        label="${t=>`Remove ${t.label}`}"
                                                        ?disabled="${(t,e)=>e.parent.disabled}"
                                                        @click="${(t,e)=>(e.parent.removeAttachmentById(t.id),!0)}"
                                                    >
                                                        <violet-icon icon="system/dismiss" decorative></violet-icon>
                                                    </violet-icon-button>
                                                `)}
                                        </div>
                                    `)}
                            </div>
                        `)}
                    ${b(t=>t.attachments.length===0,u`
                            <div class="empty" part="empty-state">No attachments yet</div>
                        `)}
                    ${b(t=>!t.readonly,u`
                            <violet-file-upload
                                class="add-upload"
                                part="add-control"
                                appearance="button"
                                size="compact"
                                multiple
                                ?disabled="${t=>t.disabled}"
                                @input="${(t,e)=>(e.event.stopPropagation(),!0)}"
                                @change="${(t,e)=>(t.handleUploadChange(e.event),!0)}"
                            ></violet-file-upload>
                        `)}
                </div>
            `)}
    </div>
`,Yt=class extends f{#e=++Hm;#t="[]";#i=new Set;#r=!1;#n=0;#s=null;#o=[];#a=()=>this.positionPanel();#l=e=>{let i=e.relatedTarget;i&&i!==this&&!this.shadowRoot?.contains(i)&&this.close(!0)};#c=e=>{!this.open||e.composedPath().includes(this)||this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.readonly=!1,this.attachments=[],this.open=!1}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#l),this.ownerDocument.addEventListener("pointerdown",this.#c,!0)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#c,!0),this.removeEventListener("focusout",this.#l),this.close(!1),super.disconnectedCallback(),this.attachments.forEach(Od),this.releaseAllOwnedPreviewUrls()}get value(){return Po(this.attachments)}set value(e){let i=Vo(e);Po(i)!==this.value&&this.setAttachments(i)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Edit attachments"}get triggerLabelledBy(){return this.attachments.length===0&&this.triggerLabel===(this.placeholder||"Add attachments")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get visibleAttachments(){return this.attachments.slice(0,Vd)}get overflowCount(){return Math.max(0,this.attachments.length-Vd)}get selectionLabel(){return this.attachments.length===0?this.placeholder||"Add attachments":this.attachments.length===1?this.attachments[0]?.label??"1 attachment":`${this.attachments[0]?.label??`${this.attachments.length} attachments`} +${this.attachments.length-1}`}get selectionSummary(){return this.attachments.length===0?"No attachments":`${this.attachments.length} attachment${this.attachments.length===1?"":"s"}`}attachmentsChanged(e,i){this.#r||this.syncOwnedPreviewUrls(e??[],i??[])}handleTriggerClick(){if(this.disabled)return;if(this.open){this.close(!0),this.focusTrigger();return}this.#t=this.value,this.open=!0;let e=++this.#n;K.next().then(()=>{if(!this.open||!this.$fastController.isConnected||e!==this.#n)return;let i=this.panelElement();i&&(i.showPopover(),this.startPanelTracking(),this.positionPanel(),this.#s=requestAnimationFrame(()=>{this.#s=null,this.open&&this.$fastController.isConnected&&e===this.#n&&i.focus({preventScroll:!0})}))})}disabledChanged(){this.disabled&&this.close(!0)}handlePanelToggle(e){e.newState==="closed"&&e.currentTarget===this.panelElement()&&!this.panelElement()?.matches(":popover-open")&&this.close(!0)}handlePanelKeydown(e){e.stopPropagation(),!(e.isComposing||e.keyCode===229||e.key!=="Escape")&&(e.preventDefault(),this.close(!0),this.focusTrigger())}handleUploadChange(e){if(e.stopPropagation(),this.disabled||this.readonly)return;let i=e.detail,r=e.currentTarget,o=i?.files??[];o.length!==0&&(this.appendFiles(o),r?.clearFiles())}appendFiles(e){if(this.disabled||this.readonly||e.length===0)return;let i=Md(e);this.appendAttachments(i),this.$emit("upload-request",{files:[...e],attachments:Vo(Po(i))})}appendAttachments(e){if(this.disabled||this.readonly)return;let i=Pi([...this.attachments,...e]);this.syncOwnedPreviewUrls([...this.attachments,...e],i),this.applyAttachments(i,"input")}removeAttachmentById(e){this.disabled||this.readonly||this.applyAttachments(this.attachments.filter(i=>i.id!==e),"input")}isImageItem(e){return xn(e)}applyAttachments(e,i){this.setAttachments(Pi(e)),this.$emit(i,{attachments:[...this.attachments],value:this.value})}close(e){this.#n+=1,this.stopPanelTracking();let i=this.panelElement();if(i?.matches(":popover-open")&&i.hidePopover(),!this.open)return;let r=this.value,o=r!==this.#t;this.open=!1,e&&o&&this.$emit("change",{attachments:Vo(r),value:r})}focusTrigger(){this.#s=requestAnimationFrame(()=>{this.#s=null,!(this.open||this.disabled||!this.$fastController.isConnected)&&this.shadowRoot?.querySelector(".trigger")?.focus()})}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}startPanelTracking(){this.stopPanelTracking();let e=this.getRootNode();for(;e instanceof ShadowRoot;)this.#o.push(e),e=e.host.getRootNode();this.#o.push(this.ownerDocument),this.#o.forEach(i=>{i.addEventListener("scroll",this.#a,!0)}),this.ownerDocument.defaultView?.addEventListener("resize",this.#a)}stopPanelTracking(){this.#o.forEach(e=>{e.removeEventListener("scroll",this.#a,!0)}),this.#o.length=0,this.ownerDocument.defaultView?.removeEventListener("resize",this.#a),this.#s!==null&&(cancelAnimationFrame(this.#s),this.#s=null)}positionPanel(){let e=this.panelElement(),i=this.shadowRoot?.querySelector(".trigger"),r=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!r)return;let o=i.getBoundingClientRect(),s=e.getBoundingClientRect(),n=8,a=o.bottom+6,l=a+s.height<=r.innerHeight-n?a:o.top-s.height-6;e.style.left=`${Math.max(n,Math.min(o.left,r.innerWidth-s.width-n))}px`,e.style.top=`${Math.max(n,l)}px`}setAttachments(e){this.syncOwnedPreviewUrls(this.attachments,e),this.#r=!0;try{this.attachments=e}finally{this.#r=!1}}syncOwnedPreviewUrls(e,i){let r=new Set(i.map(o=>Bo(o)).filter(o=>!!o));e.map(o=>Bo(o)).filter(o=>!!o).forEach(o=>{r.has(o)||(URL.revokeObjectURL(o),this.#i.delete(o))}),r.forEach(o=>{this.#i.add(o)})}releaseAllOwnedPreviewUrls(){this.#i.forEach(e=>{URL.revokeObjectURL(e)}),this.#i.clear()}};c(Yt.prototype,"placeholder");c({mode:"boolean"})(Yt.prototype,"disabled");c({mode:"boolean"})(Yt.prototype,"readonly");m(Yt.prototype,"attachments");m(Yt.prototype,"open");customElements.get("violet-data-grid-attachment-cell")||await f.define(Yt,{name:"violet-data-grid-attachment-cell",template:Wm,styles:qm,shadowOptions:{delegatesFocus:!0}});var Um=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Pd=0,Km=v`
    ${E}

    :host {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .label {
        padding-inline: calc(var(--_space-sm) * 1.5);
        color: var(--_text-secondary);
        font-size: var(--_caption-size);
        font-weight: 600;
        line-height: var(--_caption-line);
        letter-spacing: 0.02em;
    }

    :host([disabled]) .label {
        color: var(--_text-muted);
    }

    .options {
        display: grid;
        gap: 2px;
    }

    ::slotted(violet-option) {
        --violet-option-padding-inline-start: calc(var(--_space-sm) * 3);
    }
`,Gm=u`
    ${b(t=>!!t.label,u`
            <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
        `)}
    <div class="options" part="options">
        <slot></slot>
    </div>
`,Bi=class extends f{#e;constructor(){super(),this.#e=this.attachInternals(),this.label="",this.disabled=!1,Pd+=1,this.labelId=`violet-option-group-label-${Pd}`}connectedCallback(){super.connectedCallback(),this.#t()}labelChanged(){this.#t()}disabledChanged(){for(let e of this.querySelectorAll("violet-option"))e.closest("violet-option-group")===this&&(e.groupDisabled=this.disabled);this.$emit("group-state-change",{disabled:this.disabled})}#t(){this.#e.role="group",this.#e.ariaLabel=this.label||""}};Um([m],Bi.prototype,"labelId",void 0);c(Bi.prototype,"label");c({mode:"boolean"})(Bi.prototype,"disabled");customElements.get("violet-option-group")||await f.define(Bi,{name:"violet-option-group",template:Gm,styles:Km});var wn=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Bd=0,Ym=v`
    ${Ce}

    /* An author style beats the user agent's [hidden] rule, so a filtered-out option needs its own. */
    :host([hidden]) {
        display: none;
    }

    :host {
        display: block;
        --_surface-hover: var(--color-surface-subtle, #f0efe6);
        --_surface-active: var(--color-surface-highlight, #ffffff);
        --_surface-selected: color-mix(in srgb, var(--color-state-success-background, #e3f1e7) 58%, transparent);
        --_selected-border: color-mix(in srgb, var(--color-state-success-foreground, #245c36) 30%, transparent);
        --_option-padding-inline-start: var(--violet-option-padding-inline-start, calc(var(--_space-inline-md) * 1.5));
        --_option-padding-inline-end: var(--violet-option-padding-inline-end, calc(var(--_space-inline-md) * 1.5));
    }

    .control {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-sm);
        min-block-size: var(--_target-size);
        padding-inline-start: var(--_option-padding-inline-start);
        padding-inline-end: var(--_option-padding-inline-end);
        padding-block: var(--_space-inline-sm);
        border: 1px solid transparent;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard);
    }

    .control.active {
        background: var(--_surface-active);
        border-color: color-mix(in srgb, var(--_focus-ring) 40%, transparent);
    }

    :host([selected]) .control {
        background: var(--_surface-selected);
        border-color: var(--_selected-border);
    }

    .control.active.selected {
        border-color: color-mix(in srgb, var(--_focus-ring) 45%, var(--_selected-border));
    }

    .control:not(.disabled):hover {
        background: var(--_surface-hover);
    }

    .control.disabled {
        color: var(--_text-secondary);
        cursor: not-allowed;
        opacity: 0.6;
    }

    .before,
    .after {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 0;
    }

    .content {
        display: grid;
        gap: 2px;
        min-inline-size: 0;
    }

    .label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .description {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    /* Muted text fails 4.5:1 on the tinted selected surface; use secondary text there. */
    :host([selected]) .description {
        color: var(--_text-secondary);
    }

    @media (forced-colors: active) {
        .control {
            forced-color-adjust: none;
            border-color: transparent;
            background: Canvas;
            color: ButtonText;
        }

        .control.active,
        :host([selected]) .control {
            border-color: Highlight;
            background: Highlight;
            color: HighlightText;
        }

        .control.disabled {
            color: GrayText;
        }
    }
`,Xm=u`
    <div
        class="${t=>`control${t.active?" active":""}${t.selected?" selected":""}${t.isDisabled?" disabled":""}`}"
        part="control"
        @click="${(t,e)=>t.handleClick(e.event)}"
    >
        <span class="before" part="before"><slot name="before"></slot></span>
        <span class="content" part="content">
            <span class="label" part="label"><slot></slot></span>
            <span class="description" part="description" ?hidden="${t=>!t.hasDescription}">
                <slot name="description" @slotchange="${t=>t.handleDescriptionSlotChange()}"></slot>
            </span>
        </span>
        <span class="after" part="after"><slot name="after"></slot></span>
    </div>
`,at=class extends f{constructor(){super(),Bd+=1,this.optionId=`violet-option-${Bd}`,this.value="",this.label="",this.selected=!1,this.active=!1,this.disabled=!1,this.groupDisabled=!1,this.hasDescription=!1}connectedCallback(){super.connectedCallback(),this.id||=this.optionId,this.setAttribute("role","option"),this.#t(),this.handleDescriptionSlotChange(),this.#e()}selectedChanged(){this.#t()}disabledChanged(){this.#t()}groupDisabledChanged(){this.#t()}labelChanged(){this.#e()}handleDescriptionSlotChange(){let i=this.shadowRoot?.querySelector('slot[name="description"]')?.assignedNodes({flatten:!0}).some(r=>r.textContent?.trim());this.hasDescription=!!i}handleClick(e){if(this.isDisabled){e.preventDefault(),e.stopPropagation();return}this.$emit("request-select",{value:this.value})}get labelText(){return this.label?this.label:Array.from(this.childNodes).filter(i=>!(i instanceof HTMLElement&&i.slot)).map(i=>i.textContent??"").join(" ").replace(/\s+/g," ").trim()}get isDisabled(){return this.disabled||this.groupDisabled}#e(){this.value||(this.value=this.labelText)}#t(){this.isConnected&&(this.setAttribute("aria-selected",String(this.selected)),this.isDisabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled"))}};wn([m],at.prototype,"active",void 0);wn([m],at.prototype,"hasDescription",void 0);wn([m],at.prototype,"groupDisabled",void 0);c(at.prototype,"value");c(at.prototype,"label");c({mode:"boolean"})(at.prototype,"selected");c({mode:"boolean"})(at.prototype,"disabled");customElements.get("violet-option")||await f.define(at,{name:"violet-option",template:Xm,styles:Ym});function Ee(t){return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"")}function Ni(t){let e=t.closest("violet-option-group");return!!(t.disabled||e?.disabled)}function ji(t){let e=t.localName;return Array.from(t.querySelectorAll("violet-option")).filter(i=>i.closest(e)===t)}function oe(t){return t.filter(e=>!Ni(e))}function ci(t,e){return e?t.find(i=>i.value===e&&!Ni(i))??null:t.find(i=>i.selected&&!Ni(i))??null}function Hi(t,e,i){if(t.length===0)return-1;let r=e;for(let o=0;o<t.length;o+=1)if(r=(r+i+t.length)%t.length,t[r]&&!Ni(t[r]))return r;return-1}function Nd(t,e,i){let r=oe(t);if(r.length===0||!e)return null;let o=Ee(e.trim()),s=r.findIndex(a=>a.value===i);return(s>=0?[...r.slice(s+1),...r.slice(0,s+1)]:r).find(a=>Ee(a.labelText).startsWith(o))??null}function qi(t,e,i){let r=new Set(Array.isArray(e)?e:e?[e]:[]);for(let o of t)o.groupDisabled=!!o.closest("violet-option-group")?.disabled,o.selected=r.has(o.value),o.active=i!==""&&o.value===i}var Hd=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},jd=0,Qm=v`
    ${E}

    :host {
        display: grid;
        --_panel-min-inline: var(--violet-listbox-min-inline-size, 14rem);
        --_panel-max-block: var(--violet-listbox-max-block-size, 18rem);
        --_panel-padding: var(--violet-listbox-padding, var(--_space-inline-sm));
    }

    .control {
        box-sizing: border-box;
        display: grid;
        gap: 2px;
        min-inline-size: var(--_panel-min-inline);
        max-block-size: min(var(--_panel-max-block), 70vh);
        overflow: auto;
        padding: var(--_panel-padding);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        outline: none;
    }

    .control:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 45%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    :host([disabled]) .control {
        opacity: 0.65;
        cursor: not-allowed;
    }

    @media (forced-colors: active) {
        .control {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }

        .control:focus-visible {
            border-color: Highlight;
            box-shadow: 0 0 0 2px Highlight;
        }
    }
`,Jm=u`
    <div
        id="${t=>t.listboxId}"
        class="control"
        part="control"
        role="listbox"
        tabindex="${t=>t.disabled?"-1":"0"}"
        aria-disabled="${t=>String(t.disabled)}"
        aria-multiselectable="${t=>t.multiple?"true":null}"
        aria-label="${t=>t.label||t.getAttribute("aria-label")||"Options"}"
        @focus="${t=>t.handleFocus()}"
        @keydown="${(t,e)=>t.handleKeydown(e.event)}"
    >
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </div>
`,lt=class extends f{#e="";#t=0;constructor(){super(),jd+=1,this.listboxId=`violet-listbox-${jd}`,this.label="",this.value="",this.activeValue="",this.selectedValues=[],this.disabled=!1,this.multiple=!1,this.selectionFollowsFocus=!1}connectedCallback(){super.connectedCallback(),this.addEventListener("request-select",this.handleRequestSelect),this.handleSlotChange()}disconnectedCallback(){this.removeEventListener("request-select",this.handleRequestSelect),super.disconnectedCallback()}get options(){return ji(this)}get activeOptionId(){return this.options.find(e=>e.value===this.activeValue)?.optionId??""}handleSlotChange(){let e=oe(this.options);if(this.multiple){let i=this.selectedValues.length>0?this.selectedValues.filter(r=>e.some(o=>o.value===r)):this.options.filter(r=>r.selected&&e.some(o=>o===r)).map(r=>r.value);this.selectedValues=i,this.value=this.selectedValues[0]??"",(!this.activeValue||!e.some(r=>r.value===this.activeValue))&&(this.activeValue=this.selectedValues[0]??e[0]?.value??"")}else{let i=ci(this.options,this.value),r=i?.value??e[0]?.value??"";!this.value&&i&&(this.value=i.value),this.selectedValues=this.value?[this.value]:[],(!this.activeValue||!e.some(o=>o.value===this.activeValue))&&(this.activeValue=r)}this.#o()}handleFocus(){if(!this.disabled){if(!this.activeValue){let e=this.multiple?this.selectedValues[0]:ci(this.options,this.value)?.value;this.activeValue=e??oe(this.options)[0]?.value??""}this.#o(),this.#s()}}handleKeydown(e){if(this.disabled)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#i(1),!1;case"ArrowUp":return e.preventDefault(),this.#i(-1),!1;case"Home":return e.preventDefault(),this.#r(oe(this.options)[0]?.value??""),!1;case"End":{e.preventDefault();let i=oe(this.options);return this.#r(i.at(-1)?.value??""),!1}case"Enter":case" ":return e.preventDefault(),this.activeValue&&(this.multiple?this.toggleValue(this.activeValue):this.selectValue(this.activeValue)),!1;case"a":case"A":return this.multiple&&(e.ctrlKey||e.metaKey)?(e.preventDefault(),this.toggleAll(),!1):!0;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#n(e.key),!0}}handleRequestSelect(e){e.stopPropagation();let i=e.detail?.value??"";this.multiple?this.toggleValue(i):this.selectValue(i)}valueChanged(){this.multiple||(this.selectedValues=this.value?[this.value]:[]),this.#o()}activeValueChanged(){this.#o()}selectedValuesChanged(){this.multiple&&(this.value=this.selectedValues[0]??""),this.#o()}selectValue(e,i=!0){let r=oe(this.options).find(o=>o.value===e)??null;r&&(this.value=r.value,this.activeValue=r.value,this.#o(),i&&(this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value})))}toggleValue(e,i=!0){let r=oe(this.options).find(s=>s.value===e)??null;if(!r)return;let o=new Set(this.selectedValues);o.has(r.value)?o.delete(r.value):o.add(r.value),this.selectedValues=this.options.filter(s=>o.has(s.value)).map(s=>s.value),this.activeValue=r.value,this.#o(),i&&(this.$emit("input",{value:this.value,selectedValues:[...this.selectedValues]}),this.$emit("change",{value:this.value,selectedValues:[...this.selectedValues]}))}toggleAll(){let e=oe(this.options),i=e.every(r=>this.selectedValues.includes(r.value));this.selectedValues=i?[]:e.map(r=>r.value),this.activeValue=e[0]?.value??"",this.#o(),this.$emit("input",{value:this.value,selectedValues:[...this.selectedValues]}),this.$emit("change",{value:this.value,selectedValues:[...this.selectedValues]})}#i(e){let i=this.options,r=i.findIndex(n=>n.value===this.activeValue),o=Hi(i,r<0?e===1?-1:0:r,e),s=i[o]?.value??"";this.#r(s)}#r(e){this.activeValue=e,this.#o(),this.#s(),!this.multiple&&this.selectionFollowsFocus&&e&&this.selectValue(e)}#n(e){window.clearTimeout(this.#t),this.#e=`${this.#e}${e.toLowerCase()}`;let i=Nd(this.options,this.#e,this.activeValue);i&&this.#r(i.value),this.#t=window.setTimeout(()=>{this.#e=""},500)}#s(){this.options.find(i=>i.value===this.activeValue)?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#o(){qi(this.options,this.multiple?this.selectedValues:this.value,this.activeValue);let e=this.shadowRoot?.querySelector('[role="listbox"]');e&&(e.ariaActiveDescendantElement=this.options.find(i=>i.value===this.activeValue)??null)}};Hd([m],lt.prototype,"activeValue",void 0);Hd([m],lt.prototype,"selectedValues",void 0);c(lt.prototype,"label");c(lt.prototype,"value");c({mode:"boolean"})(lt.prototype,"disabled");c({mode:"boolean"})(lt.prototype,"multiple");c({mode:"boolean",attribute:"selection-follows-focus"})(lt.prototype,"selectionFollowsFocus");customElements.get("violet-listbox")||await f.define(lt,{name:"violet-listbox",template:Jm,styles:Qm,shadowOptions:{delegatesFocus:!0}});function Wi(t,e){let i=e.trim().toLowerCase();return i?t.filter(r=>[r.label,r.value,r.description??"",...r.keywords??[]].join(" ").toLowerCase().includes(i)):t}function Zm(t,e){return t.find(i=>i.value===e)??null}function Ui(t,e){return Zm(t,e)??{label:e,value:e}}function _n(t){let e=Ki(t);return`background:${e.background};color:${e.foreground};border-color:${e.borderColor};`}function Ki(t){if(t.background||t.foreground||t.borderColor)return{background:t.background??"var(--_surface-subtle)",foreground:t.foreground??"var(--_text-primary)",borderColor:t.borderColor??"transparent"};switch(t.tone){case"teal":return{background:"#0b7280",foreground:"#ffffff",borderColor:"transparent"};case"green":return{background:"#176c27",foreground:"#ffffff",borderColor:"transparent"};case"olive":return{background:"#547d46",foreground:"#f5fbf2",borderColor:"transparent"};case"gold":return{background:"#8b6b24",foreground:"#fff7de",borderColor:"transparent"};case"blue":return{background:"#416b89",foreground:"#ffffff",borderColor:"transparent"};case"gray":return{background:"#606672",foreground:"#f6f7fa",borderColor:"transparent"};default:return{background:"color-mix(in srgb, var(--_surface-subtle) 90%, white)",foreground:"var(--_text-primary)",borderColor:"color-mix(in srgb, var(--_border-subtle) 80%, transparent)"}}}function Gi(t){let e=new Set,i=[];for(let r of t){let o=String(r??"").trim();!o||e.has(o)||(e.add(o),i.push(o))}return i}function qd(t){if(Array.isArray(t))return Gi(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return Gi(i)}catch{}return Gi(e.split(/\s*,\s*/u))}function jo(t){return JSON.stringify(Gi(t))}var eg=0,Wd=2,tg=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_pill-font-size: var(--violet-data-grid-pill-font-size, 0.8125rem);
        --_size-font-md: var(--size-font-md, 14px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.7;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
        border-radius: var(--_radius-sm);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .pills {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.375rem;
        padding-inline: 0.625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .pill-label,
    .placeholder {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .overflow-pill {
        background: color-mix(in srgb, var(--_surface-subtle) 88%, white);
        border-color: color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        color: var(--_text-secondary);
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: fixed;
        inset: unset;
        margin: 0;
        box-sizing: border-box;
        max-inline-size: calc(100vw - 16px);
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        z-index: var(--_layer-popover);
        display: grid;
        gap: 0.5rem;
        inline-size: min(18rem, max(14rem, 100%));
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .listbox {
        --violet-listbox-min-inline-size: 100%;
        --violet-listbox-max-block-size: 12rem;
        --violet-listbox-padding: 0.25rem;
    }

    .option-swatch {
        inline-size: 0.625rem;
        block-size: 0.625rem;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 75%, transparent);
        box-sizing: border-box;
    }

    .option-check {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        font-weight: 700;
        line-height: 1;
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`,ig=u`
    <div class="root" part="base">
        <span id="trigger-label" hidden>${t=>t.triggerLabel}</span>
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${t=>t.disabled}"
            aria-labelledby="${t=>t.triggerLabelledBy}"
            aria-haspopup="listbox"
            aria-controls="${t=>t.panelId}"
            aria-expanded="${t=>String(t.open)}"
            @click="${t=>(t.handleTriggerClick(),!0)}"
            @keydown="${(t,e)=>(t.handleTriggerKeydown(e.event),!0)}"
        >
            <span class="selection" id="trigger-value" part="selection" data-empty="${t=>String(t.selectedValues.length===0)}">
                <span class="pills">
                    ${b(t=>t.selectedValues.length===0,u`
                            <span class="placeholder">${t=>t.placeholder||"Add options"}</span>
                        `)}
                    ${L(t=>t.visibleSelectedEntries,u`
                            <span class="pill" part="pill" style="${(t,e)=>e.parent.pillStyleForValue(t.value)}">
                                <span class="pill-label">${t=>t.label}</span>
                            </span>
                        `)}
                    ${b(t=>t.overflowCount>0,u`
                            <span class="pill overflow-pill" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${b(t=>t.open,u`
                <div class="panel" id="${t=>t.panelId}" part="panel" popover="manual"
                    @toggle="${(t,e)=>(t.handlePanelToggle(e.event),!0)}">
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find options"
                        aria-label="Find options"
                        aria-controls="${t=>t.listboxId}"
                        :value="${t=>t.filterQuery}"
                        @input="${(t,e)=>(t.handleSearchInput(e.event),!0)}"
                        @keydown="${(t,e)=>(t.handleSearchKeydown(e.event),!0)}"
                    />
                    <div class="selection-summary" part="selection-summary" role="status">${t=>t.selectionSummary}</div>
                            <violet-listbox
                                id="${t=>t.listboxId}"
                                class="listbox"
                                part="listbox"
                                multiple
                                ?disabled="${t=>t.disabled}"
                                aria-label="${t=>t.getAttribute("aria-label")||t.placeholder||"Options"}"
                                :selectedValues="${t=>t.selectedValues}"
                                @input="${(t,e)=>(t.handleListboxInput(e.event),!0)}"
                                @change="${(t,e)=>(t.handleListboxChange(e.event),!0)}"
                                @keydown="${(t,e)=>(t.handleListboxKeydown(e.event),!0)}"
                            >
                                ${L(t=>t.filteredOptions,u`
                                        <violet-option value="${t=>t.value}" label="${t=>t.label}">
                                            <span
                                                slot="before"
                                                class="option-swatch"
                                                style="${(t,e)=>e.parent.optionSwatchStyle(t)}"
                                            ></span>
                                            <span
                                                slot="after"
                                                class="option-check"
                                                ?hidden="${(t,e)=>!e.parent.isSelected(t.value)}"
                                            >Selected</span>
                                            ${t=>t.label}
                                        </violet-option>
                                    `)}
                            </violet-listbox>
                    ${b(t=>t.filteredOptions.length===0,u`
                            <div class="empty" part="empty-state" role="status">No matching options</div>
                        `)}
                </div>
            `)}
    </div>
`,$t=class extends f{#e=++eg;#t="[]";#i=null;#r=0;#n=null;#s=null;#o=e=>{let i=this.panelElement();i&&!e.composedPath().includes(i)&&this.positionPanel()};#a=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#l=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let r=e.composedPath();if(e.type==="pointerup"&&r.includes(i)){let s=i.options.find(n=>r.includes(n));s&&!s.isDisabled&&(i.activeValue=s.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#c=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#d=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let r=this.listboxElement();e.button===0&&r&&!this.disabled&&i.includes(r)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#a),this.addEventListener("keydown",this.#c,!0),this.ownerDocument.addEventListener("pointerdown",this.#d,!0),this.ownerDocument.addEventListener("pointerup",this.#l,!0),this.ownerDocument.addEventListener("pointercancel",this.#l,!0)}disconnectedCallback(){this.close(!1),this.removeViewportListeners(),this.#r+=1,this.removeEventListener("focusout",this.#a),this.removeEventListener("keydown",this.#c,!0),this.ownerDocument.removeEventListener("pointerdown",this.#d,!0),this.ownerDocument.removeEventListener("pointerup",this.#l,!0),this.ownerDocument.removeEventListener("pointercancel",this.#l,!0),super.disconnectedCallback()}get value(){return jo(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Select options"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Add options")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get listboxId(){return`${this.panelId}-listbox`}disabledChanged(){this.disabled&&this.open&&this.close(!0)}handlePanelToggle(e){let i=this.panelElement();e.newState==="closed"&&i&&!i.matches(":popover-open")&&this.close(!0)}filterQueryChanged(){K.next().then(()=>this.positionPanel())}get selectedEntries(){return this.selectedValues.map(e=>{let i=Ui(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,Wd)}get overflowCount(){return Math.max(0,this.selectedValues.length-Wd)}get selectionSummary(){return this.selectedValues.length===0?"No options selected":`${this.selectedValues.length} option${this.selectedValues.length===1?"":"s"} selected`}get filteredOptions(){return Wi(this.options,this.filterQuery)}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel(e.key==="ArrowUp"?"last":"listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??""}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault(),e.stopPropagation(),this.focusListboxControl(e.key==="ArrowUp");return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,r=new Set(this.filteredOptions.map(s=>s.value)),o=this.selectedValues.filter(s=>!r.has(s));this.applySelection([...o,...i?.selectedValues??[]],"input")}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}toggleValue(e){if(this.disabled)return;let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}pillStyleForValue(e){let i=this.options.find(r=>r.value===e)??null;return this.optionStyle(i)}optionSwatchStyle(e){return`background:${Ki(e).background};`}syncSelectionFromValue(e){let i=qd(e);i.length===this.selectedValues.length&&i.every((r,o)=>r===this.selectedValues[o])||(this.selectedValues=i)}applySelection(e,i){this.selectedValues=this.orderedSelectedValues(new Set(Gi(e))),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(o=>e.has(o.value)).map(o=>o.value),r=[...e].filter(o=>!this.options.some(s=>s.value===o));return[...i,...r]}optionStyle(e){return e?_n(e):_n({label:"",value:""})}close(e){if(this.#s=null,!this.open)return;this.#r+=1;let i=jo(this.selectedValues),r=i!==this.#t;this.#i=null,this.open=!1;let o=this.panelElement();o?.matches(":popover-open")&&o.hidePopover(),this.removeViewportListeners(),this.filterQuery="",e&&r&&this.$emit("change",{value:i,selectedValues:[...this.selectedValues]})}openPanel(e){if(this.disabled)return;this.#r+=1,this.open||(this.#t=jo(this.selectedValues)),this.#i=e,this.open=!0;let i=this.getRootNode();this.#n=i instanceof ShadowRoot?i:null,this.#n?.addEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.addEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.addEventListener("resize",this.#o),this.queueOpenFocus()}queueOpenFocus(){let e=this.#r,i=this.#i;this.#i=null,i&&K.next().then(()=>{e!==this.#r||!this.open||!this.$fastController.isConnected||requestAnimationFrame(()=>{if(e!==this.#r||!this.open||!this.$fastController.isConnected)return;let r=this.panelElement();if(r&&!r.matches(":popover-open")&&r.showPopover(),this.positionPanel(),i!=="search"&&this.filteredOptions.length>0){this.focusListboxControl(i==="last");return}this.focusSearch(!0)})})}focusTrigger(){this.triggerElement()?.focus()}removeViewportListeners(){this.#n?.removeEventListener("scroll",this.#o,!0),this.#n=null,this.ownerDocument.defaultView?.removeEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.removeEventListener("resize",this.#o)}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),r=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!r)return;let o=i.getBoundingClientRect(),s=8,n=6;e.style.inlineSize=`${Math.min(Math.max(o.width,288),r.innerWidth-s*2)}px`;let a=e.getBoundingClientRect(),l=Math.max(s,Math.min(o.left,r.innerWidth-a.width-s)),d=o.bottom+n,h=d+a.height<=r.innerHeight-s?d:o.top-a.height-n;e.style.left=`${l}px`,e.style.top=`${Math.max(s,Math.min(h,r.innerHeight-a.height-s))}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(e=!1){let i=this.listboxElement(),r=i?.shadowRoot?.querySelector('[role="listbox"]');i&&this.filteredOptions.length>0&&(i.activeValue=(e?this.filteredOptions.at(-1):this.filteredOptions[0])?.value??""),r?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}};c($t.prototype,"placeholder");c({mode:"boolean"})($t.prototype,"disabled");m($t.prototype,"selectedValues");m($t.prototype,"options");m($t.prototype,"open");m($t.prototype,"filterQuery");customElements.get("violet-data-grid-multi-picker")||await f.define($t,{name:"violet-data-grid-multi-picker",template:ig,styles:tg,shadowOptions:{delegatesFocus:!0}});var Kd=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Ud=0,rg=v`
    ${E}

    :host {
        display: inline-flex;
        --_persona-size: var(--violet-persona-size, 32px);
        --_persona-font-size: var(--violet-persona-font-size, 12px);
        --_persona-border-color: color-mix(in srgb, var(--_border-subtle) 90%, transparent);
        --_persona-shadow: var(--shadow-control, 0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04));
    }

    :host([size="xs"]) {
        --_persona-size: var(--violet-persona-size, 24px);
        --_persona-font-size: var(--violet-persona-font-size, 10px);
    }

    :host([size="sm"]) {
        --_persona-size: var(--violet-persona-size, 32px);
        --_persona-font-size: var(--violet-persona-font-size, 12px);
    }

    :host([size="md"]) {
        --_persona-size: var(--violet-persona-size, 40px);
        --_persona-font-size: var(--violet-persona-font-size, 14px);
    }

    :host([size="lg"]) {
        --_persona-size: var(--violet-persona-size, 48px);
        --_persona-font-size: var(--violet-persona-font-size, 16px);
    }

    :host([size="xl"]) {
        --_persona-size: var(--violet-persona-size, 64px);
        --_persona-font-size: var(--violet-persona-font-size, 20px);
    }

    .root {
        position: relative;
        display: grid;
        place-items: center;
        inline-size: var(--_persona-size);
        block-size: var(--_persona-size);
        overflow: hidden;
        border: 1px solid var(--_persona-border-color);
        border-radius: var(--_radius-round);
        background: var(--_tone-background, var(--_surface-subtle));
        box-shadow: var(--_persona-shadow);
        color: var(--_tone-foreground, var(--_text-primary));
        font-size: var(--_persona-font-size);
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        user-select: none;
        -webkit-user-select: none;
    }

    .root[data-tone="moss"] {
        --_tone-background: color-mix(in srgb, #b9d3b0 48%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .root[data-tone="sky"] {
        --_tone-background: color-mix(in srgb, #b8d2eb 50%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .root[data-tone="amber"] {
        --_tone-background: color-mix(in srgb, #e8d09c 52%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .root[data-tone="terracotta"] {
        --_tone-background: color-mix(in srgb, #e2b29d 54%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .root[data-tone="plum"] {
        --_tone-background: color-mix(in srgb, #cfbddb 54%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .root[data-tone="slate"] {
        --_tone-background: color-mix(in srgb, #c8cfdb 56%, var(--_surface-card));
        --_tone-foreground: var(--_text-primary);
    }

    .image {
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
        display: block;
    }

    .fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 100%;
        block-size: 100%;
    }

    /*
     * The initials repeat the label, which the root already carries, so they are generated
     * content and no text of the page: a control that holds a persona is then not judged to
     * show text its name lacks (WCAG 2.5.3).
     */
    .fallback::before {
        content: attr(data-initials);
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`,og=u`
    <div
        class="root"
        part="root"
        data-tone="${t=>t.tone}"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
        aria-label="${t=>t.decorative?null:t.accessibleLabel}"
    >
        ${b(t=>!!t.src,u`
                <img
                    class="image"
                    part="image"
                    src="${t=>t.src}"
                    alt=""
                    ?hidden="${t=>t.imageFailed}"
                    @error="${t=>t.handleImageError()}"
                />
            `)}
        <span
            class="fallback"
            part="fallback"
            aria-hidden="true"
            data-initials="${t=>t.displayInitials}"
            ?hidden="${t=>!!t.src&&!t.imageFailed}"
        ></span>
    </div>
`,ct=class extends f{constructor(){super(),Ud+=1,this.personaId=`violet-persona-${Ud}`,this.label="",this.src="",this.initials="",this.decorative=!1,this.size="sm",this.imageFailed=!1,this.tone="moss"}connectedCallback(){super.connectedCallback(),this.syncTone()}labelChanged(){this.syncTone()}initialsChanged(){this.syncTone()}srcChanged(){this.imageFailed=!1}handleImageError(){this.imageFailed=!0}get accessibleLabel(){return R.trackVolatile(),this.label||this.displayInitials||"Persona"}get displayInitials(){return R.trackVolatile(),this.initials.trim()?this.initials.trim().slice(0,this.size==="xs"?1:3).toUpperCase():sg(this.label,this.size==="xs")||"?"}syncTone(){let e=this.label||this.initials||this.personaId||"",i=["moss","sky","amber","terracotta","plum","slate"],r=Array.from(e).reduce((o,s)=>o+s.charCodeAt(0),0);this.tone=i[r%i.length]??"moss"}};Kd([m],ct.prototype,"imageFailed",void 0);Kd([m],ct.prototype,"tone",void 0);function sg(t,e){let i=t.replace(/\s+/g," ").trim();if(!i)return"";let r=i.split(" ").map(o=>o.replace(/[^A-Za-z0-9]/g,"")).filter(Boolean);return r.length===0?"":e||r.length===1?r[0].charAt(0).toUpperCase():`${r[0].charAt(0)}${r.at(-1)?.charAt(0)??""}`.toUpperCase()}c(ct.prototype,"label");c(ct.prototype,"src");c(ct.prototype,"initials");c({mode:"boolean"})(ct.prototype,"decorative");c(ct.prototype,"size");customElements.get("violet-persona")||await f.define(ct,{name:"violet-persona",template:og,styles:rg});function Yi(t){let e=new Set,i=[];for(let r of t){let o=String(r??"").trim();!o||e.has(o)||(e.add(o),i.push(o))}return i}function Gd(t){if(Array.isArray(t))return Yi(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return Yi(i)}catch{}return Yi(e.split(/\s*,\s*/u))}function Ho(t){return JSON.stringify(Yi(t))}var ng=0,Yd=3,ag=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_size-font-md: var(--size-font-md, 14px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.7;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
        border-radius: var(--_radius-md);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: 0.8125rem;
        font-weight: 400;
        line-height: 1;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .summary {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .persona-stack {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        flex: 0 0 auto;
    }

    .stack-item {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-inline-start: -0.375rem;
        border-radius: 999px;
        background: var(--_surface-page);
    }

    .stack-item:first-child {
        margin-inline-start: 0;
    }

    .stack-overflow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 1.5rem;
        min-block-size: 1.5rem;
        margin-inline-start: -0.375rem;
        padding-inline: 0.375rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--_surface-subtle) 88%, white);
        color: var(--_text-secondary);
        font-size: 0.75rem;
        line-height: 1;
    }

    violet-persona.stack-persona,
    violet-persona.option-persona {
        --violet-persona-size: 1.5rem;
        --violet-persona-font-size: 0.625rem;
    }

    violet-persona.option-persona {
        --violet-persona-size: 1.75rem;
        --violet-persona-font-size: 0.75rem;
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: fixed;
        inset: unset;
        margin: 0;
        box-sizing: border-box;
        z-index: var(--_layer-popover);
        display: none;
        gap: 0.5rem;
        inline-size: min(20rem, calc(100vw - 16px));
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
        color: var(--_text-primary);
    }

    .panel:popover-open {
        display: grid;
    }

    @media (forced-colors: active) {
        .trigger:focus-visible,
        .search:focus-visible {
            outline: 2px solid Highlight;
        }

        .panel {
            border-color: CanvasText;
        }
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .listbox {
        --violet-listbox-min-inline-size: 100%;
        --violet-listbox-max-block-size: 13rem;
        --violet-listbox-padding: 0.25rem;
    }

    .option-check {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        font-weight: 700;
        line-height: 1;
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`,lg=u`
    <div class="root" part="base" @keydown="${(t,e)=>(t.handlePanelKeydown(e.event),!0)}">
        <span id="trigger-label" hidden>${t=>t.triggerLabel}</span>
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${t=>t.disabled}"
            aria-labelledby="${t=>t.triggerLabelledBy}"
            aria-haspopup="dialog"
            aria-controls="${t=>t.panelId}"
            aria-expanded="${t=>String(t.open)}"
            @click="${t=>(t.handleTriggerClick(),!0)}"
            @keydown="${(t,e)=>(t.handleTriggerKeydown(e.event),!0)}"
        >
            <span class="selection" id="trigger-value" part="selection" data-empty="${t=>String(t.selectedValues.length===0)}">
                ${b(t=>t.selectedValues.length>0,u`
                        <span class="persona-stack">
                            ${L(t=>t.visibleSelectedEntries,u`
                                    <span class="stack-item">
                                        <violet-persona
                                            class="stack-persona"
                                            decorative
                                            size="xs"
                                            label="${t=>t.option?.label??t.label}"
                                            initials="${t=>t.option?.initials??""}"
                                            src="${t=>t.option?.src??""}"
                                        ></violet-persona>
                                    </span>
                                `)}
                            ${b(t=>t.overflowCount>0,u`
                                    <span class="stack-overflow" part="overflow-pill">+${t=>t.overflowCount}</span>
                                `)}
                        </span>
                    `)}
                <span class="summary">${t=>t.selectionLabel}</span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${b(t=>t.open,u`
                <div
                    class="panel"
                    id="${t=>t.panelId}"
                    part="panel"
                    popover="manual"
                    role="dialog"
                    aria-label="${t=>t.getAttribute("aria-label")||t.placeholder||"Assign people"}"
                    @toggle="${(t,e)=>(t.handlePanelToggle(e.event),!0)}"
                >
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find people"
                        aria-label="Find people"
                        :value="${t=>t.filterQuery}"
                        @input="${(t,e)=>(t.handleSearchInput(e.event),!0)}"
                        @keydown="${(t,e)=>(t.handleSearchKeydown(e.event),!0)}"
                    />
                    <div class="selection-summary" part="selection-summary">${t=>t.selectionSummary}</div>
                    ${b(t=>t.filteredOptions.length>0,u`
                            <violet-listbox
                                class="listbox"
                                part="listbox"
                                ?multiple="${t=>t.multiple}"
                                ?disabled="${t=>t.disabled}"
                                aria-label="${t=>t.getAttribute("aria-label")||t.placeholder||"People"}"
                                :value="${t=>t.selectedValues[0]??""}"
                                :selectedValues="${t=>t.selectedValues}"
                                @input="${(t,e)=>(t.handleListboxInput(e.event),!0)}"
                                @change="${(t,e)=>(t.handleListboxChange(e.event),!0)}"
                                @keydown="${(t,e)=>(t.handleListboxKeydown(e.event),!0)}"
                            >
                                ${L(t=>t.filteredOptions,u`
                                        <violet-option value="${t=>t.value}" label="${t=>t.label}">
                                            <violet-persona
                                                slot="before"
                                                class="option-persona"
                                                decorative
                                                size="sm"
                                                label="${t=>t.label}"
                                                initials="${t=>t.initials??""}"
                                                src="${t=>t.src??""}"
                                            ></violet-persona>
                                            ${b(t=>!!t.description,u`
                                                    <span slot="description">${t=>t.description}</span>
                                                `)}
                                            <span
                                                slot="after"
                                                class="option-check"
                                                ?hidden="${(t,e)=>!e.parent.isSelected(t.value)}"
                                            >Assigned</span>
                                            ${t=>t.label}
                                        </violet-option>
                                    `)}
                            </violet-listbox>
                        `)}
                    ${b(t=>t.filteredOptions.length===0,u`
                            <div class="empty" part="empty-state">No matching people</div>
                        `)}
                </div>
            `)}
    </div>
`,dt=class extends f{#e=++ng;#t="[]";#i=null;#r=0;#n=null;#s=null;#o=[];#a=()=>this.positionPanel();#l=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#c=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let r=e.composedPath();if(e.type==="pointerup"&&r.includes(i)){let s=i.options.find(n=>r.includes(n));s&&!s.isDisabled&&(i.activeValue=s.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#d=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#u=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let r=this.listboxElement();e.button===0&&r&&!this.disabled&&i.includes(r)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.multiple=!0,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("keydown",this.#d,!0),this.addEventListener("focusout",this.#l),this.ownerDocument.addEventListener("pointerdown",this.#u,!0),this.ownerDocument.addEventListener("pointerup",this.#c,!0),this.ownerDocument.addEventListener("pointercancel",this.#c,!0)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#u,!0),this.ownerDocument.removeEventListener("pointerup",this.#c,!0),this.ownerDocument.removeEventListener("pointercancel",this.#c,!0),this.removeEventListener("keydown",this.#d,!0),this.removeEventListener("focusout",this.#l),this.close(!1),super.disconnectedCallback()}disabledChanged(){this.disabled&&this.close(!0)}handlePanelToggle(e){e.newState==="closed"&&e.currentTarget===this.panelElement()&&!this.panelElement()?.matches(":popover-open")&&this.close(!0)}handlePanelKeydown(e){this.open&&(e.stopPropagation(),e.key==="Escape"&&!e.isComposing&&e.keyCode!==229&&(e.preventDefault(),this.close(!0),this.focusTrigger()))}get value(){return Ho(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Assign people"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Assign people")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get selectedEntries(){return this.selectedValues.map(e=>{let i=Ui(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,Yd)}get overflowCount(){return Math.max(0,this.selectedValues.length-Yd)}get selectionLabel(){return this.selectedValues.length===0?this.placeholder||"Assign people":this.selectedValues.length===1?this.selectedEntries[0]?.label??"1 assignee":`${this.selectedEntries[0]?.label??`${this.selectedValues.length} assignees`} +${this.selectedValues.length-1}`}get selectionSummary(){return this.selectedValues.length===0?"No assignees":`${this.selectedValues.length} assignee${this.selectedValues.length===1?"":"s"}`}get filteredOptions(){return Wi(this.options,this.filterQuery)}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel("listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??""}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"){e.preventDefault(),e.stopPropagation(),this.focusListboxControl();return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,r=new Set(this.filteredOptions.map(n=>n.value)),o=this.selectedValues.filter(n=>!r.has(n)),s=this.multiple?[...o,...i?.selectedValues??[]]:i?.value?[i.value]:[];this.applySelection(s,"input"),this.multiple||(this.close(!0),this.focusTrigger())}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}toggleValue(e){if(this.disabled)return;if(!this.multiple){let r=this.selectedValues.length===1&&this.selectedValues[0]===e;this.applySelection(r?[]:[e],"input");return}let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}syncSelectionFromValue(e){let i=Gd(e),r=this.multiple?i:i.slice(0,1);r.length===this.selectedValues.length&&r.every((o,s)=>o===this.selectedValues[s])||(this.selectedValues=r)}applySelection(e,i){let r=Yi(e);this.selectedValues=this.multiple?this.orderedSelectedValues(new Set(r)):r.slice(0,1),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(o=>e.has(o.value)).map(o=>o.value),r=[...e].filter(o=>!this.options.some(s=>s.value===o));return[...i,...r]}close(e){this.#s=null,this.#r+=1,this.stopPanelTracking();let i=this.panelElement();if(i?.matches(":popover-open")&&i.hidePopover(),!this.open)return;let r=Ho(this.selectedValues),o=r!==this.#t;this.#i=null,this.open=!1,this.filterQuery="",e&&o&&this.$emit("change",{value:r,selectedValues:[...this.selectedValues]})}openPanel(e){this.open||(this.#t=Ho(this.selectedValues)),this.#i=e,this.open=!0,this.queueOpenFocus()}queueOpenFocus(){let e=this.#i;if(this.#i=null,!e)return;let i=++this.#r;K.next().then(()=>{if(!this.open||!this.$fastController.isConnected||i!==this.#r)return;let r=this.panelElement();r&&(r.matches(":popover-open")||r.showPopover(),this.startPanelTracking(),this.positionPanel(),this.#n=requestAnimationFrame(()=>{if(this.#n=null,!(!this.open||!this.$fastController.isConnected||i!==this.#r)){if(e==="listbox"&&this.filteredOptions.length>0){this.focusListboxControl();return}this.focusSearch(!0)}}))})}focusTrigger(){this.#n=requestAnimationFrame(()=>{this.#n=null,!(this.open||this.disabled||!this.$fastController.isConnected)&&this.triggerElement()?.focus()})}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}startPanelTracking(){this.stopPanelTracking();let e=this.getRootNode();for(;e instanceof ShadowRoot;)this.#o.push(e),e=e.host.getRootNode();this.#o.push(this.ownerDocument),this.#o.forEach(i=>{i.addEventListener("scroll",this.#a,!0)}),this.ownerDocument.defaultView?.addEventListener("resize",this.#a)}stopPanelTracking(){this.#o.forEach(e=>{e.removeEventListener("scroll",this.#a,!0)}),this.#o.length=0,this.ownerDocument.defaultView?.removeEventListener("resize",this.#a),this.#n!==null&&(cancelAnimationFrame(this.#n),this.#n=null)}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),r=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!r)return;let o=i.getBoundingClientRect(),s=e.getBoundingClientRect(),n=8,a=o.bottom+6,l=a+s.height<=r.innerHeight-n?a:o.top-s.height-6;e.style.left=`${Math.max(n,Math.min(o.left,r.innerWidth-s.width-n))}px`,e.style.top=`${Math.max(n,l)}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(){this.listboxElement()?.shadowRoot?.querySelector(".control")?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}};c(dt.prototype,"placeholder");c({mode:"boolean"})(dt.prototype,"disabled");c({mode:"boolean"})(dt.prototype,"multiple");m(dt.prototype,"selectedValues");m(dt.prototype,"options");m(dt.prototype,"open");m(dt.prototype,"filterQuery");customElements.get("violet-data-grid-persona-picker")||await f.define(dt,{name:"violet-data-grid-persona-picker",template:lg,styles:ag,shadowOptions:{delegatesFocus:!0}});var cg=0;function kn(t){return t.isComposing||t.keyCode===229}var dg=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_pill-font-size: var(--violet-data-grid-pill-font-size, 0.8125rem);
        --_size-font-md: var(--size-font-md, 14px);
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: none;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.3125rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.625rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .pill-label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pill[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: calc(100% + 0.375rem);
        z-index: var(--_layer-popover);
        display: grid;
        gap: 0.5rem;
        inline-size: min(16rem, max(12rem, 100%));
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .options {
        display: grid;
        gap: 0.375rem;
        max-block-size: 12rem;
        overflow: auto;
        padding: 0.125rem;
    }

    .option {
        display: grid;
        justify-items: start;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        text-align: start;
        cursor: pointer;
    }

    .option:focus-visible {
        outline: none;
    }

    .option:focus-visible .option-pill {
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .option-pill {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.625rem;
        padding-inline: 0.75rem;
        border: 1px solid transparent;
        border-radius: 999px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }

    .error-text {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
    }
`,ug=u`
    <div
        class="root"
        part="base"
        @focusout="${(t,e)=>t.handleFocusOut(e.event)}"
    >
        <button
            class="trigger"
            type="button"
            part="trigger"
            aria-label="${t=>t.triggerLabel}"
            aria-haspopup="listbox"
            aria-controls="${t=>t.panelId}"
            aria-expanded="${t=>String(t.open)}"
            aria-invalid="${t=>t.invalid?"true":null}"
            aria-errormessage="${t=>t.invalid&&t.errorText?t.errorTextId:null}"
            @click="${t=>t.handleTriggerClick()}"
            @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
        >
            <span
                class="pill"
                part="pill"
                data-empty="${t=>String(!t.selectedOption)}"
                style="${t=>t.selectedOptionStyle}"
            >
                <span class="pill-label">${t=>t.selectedLabel}</span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${b(t=>t.invalid&&!!t.errorText,u`
                <span
                    class="error-text"
                    part="error-text"
                    role="${t=>t.errorAnnouncement==="self"?"alert":null}"
                    id="${t=>t.errorTextId}"
                >
                    ${t=>t.errorText}
                </span>
            `)}

        ${b(t=>t.open,u`
                <div class="panel" id="${t=>t.panelId}" part="panel">
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find an option"
                        aria-label="Find an option"
                        :value="${t=>t.filterQuery}"
                        @input="${(t,e)=>t.handleSearchInput(e.event)}"
                        @keydown="${(t,e)=>t.handleSearchKeydown(e.event)}"
                    />
                    <div class="options" part="options" role="listbox" aria-label="${t=>t.controlLabel||t.placeholder||"Options"}">
                        ${L(t=>t.filteredOptions,u`
                                <button
                                    class="option"
                                    type="button"
                                    part="option"
                                    tabindex="-1"
                                    role="option"
                                    aria-selected="${(t,e)=>String(e.parent.value===t.value)}"
                                    data-option-value="${t=>t.value}"
                                    @click="${(t,e)=>e.parent.selectOption(t.value)}"
                                    @keydown="${(t,e)=>e.parent.handleOptionKeydown(e.event,t.value)}"
                                >
                                    <span class="option-pill" part="option-pill" style="${(t,e)=>e.parent.optionStyle(t)}">
                                        ${t=>t.label}
                                    </span>
                                </button>
                            `)}
                        ${b(t=>t.filteredOptions.length===0,u`
                                <div class="empty">No matching options</div>
                            `)}
                    </div>
                </div>
            `)}
    </div>
`,Ve=class extends f{#e;#t;constructor(){super(),this.instanceId=++cg,this.#e=e=>{!this.open||e.composedPath().includes(this)||this.close()},this.#t=e=>{this.handleFocusOut(e)},this.options=[],this.invalid=!1,this.errorText="",this.errorAnnouncement="self",this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#t),this.ownerDocument.addEventListener("pointerdown",this.#e,!0),this.openChanged()}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#e,!0),this.removeEventListener("focusout",this.#t),super.disconnectedCallback()}get selectedOption(){return this.options.find(e=>e.value===this.value)??null}get selectedLabel(){return this.selectedOption?.label||this.value||this.placeholder||"Select an option"}get triggerLabel(){return this.controlLabel?`${this.controlLabel}: ${this.selectedLabel}`:this.selectedLabel}get selectedOptionStyle(){return this.selectedOption?this.optionStyle(this.selectedOption):""}get filteredOptions(){let e=this.filterQuery.trim().toLowerCase();return e?this.options.filter(i=>[i.label,i.value,...i.keywords??[]].join(" ").toLowerCase().includes(e)):this.options}get panelId(){return`${this.localName}-panel-${this.instanceId}`}get errorTextId(){return`${this.localName}-error-${this.instanceId}`}handleTriggerClick(){if(this.open){this.close();return}this.openPanel("search")}handleTriggerKeydown(e){return kn(e)?!0:e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.openPanel(this.value?"selected":"first"),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),this.openPanel(this.value?"selected":"last"),!1):e.key===" "||e.key==="Enter"?(e.preventDefault(),e.stopPropagation(),this.open?this.close():this.openPanel("search"),!1):!0}handleSearchInput(e){let i=e.target;return this.filterQuery=i?.value??"",!0}handleSearchKeydown(e){return kn(e)?!0:e.key==="Escape"?(e.preventDefault(),e.stopPropagation(),this.close(),this.focusTrigger(),!1):e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(0),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(this.filteredOptions.length-1),!1):!0}handleOptionKeydown(e,i){if(kn(e))return!0;let r=this.filteredOptions.findIndex(o=>o.value===i);return e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(Math.min(r+1,this.filteredOptions.length-1)),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),r<=0?(this.focusSearch(),!1):(this.focusOptionByIndex(r-1),!1)):e.key==="Home"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(0),!1):e.key==="End"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(this.filteredOptions.length-1),!1):e.key==="Escape"?(e.preventDefault(),e.stopPropagation(),this.close(),this.focusTrigger(),!1):e.key===" "||e.key==="Enter"?(e.preventDefault(),e.stopPropagation(),this.selectOption(i),!1):!0}handleFocusOut(e){let i=e.relatedTarget;return i&&(i===this||this.shadowRoot?.contains(i))||this.close(),!0}openChanged(){this.triggerElement()?.setAttribute("tabindex",this.open?"-1":"0")}selectOption(e){if(this.value===e){this.close(),this.focusTrigger();return}this.value=e,this.close(),this.$emit("input"),this.$emit("change"),this.focusTrigger()}optionStyle(e){let i=this.resolveOptionVisuals(e);return`background:${i.background};color:${i.foreground};border-color:${i.borderColor};`}close(){this.open=!1,this.filterQuery=""}focusTrigger(){requestAnimationFrame(()=>{this.triggerElement()?.focus()})}openPanel(e){this.open=!0,requestAnimationFrame(()=>{switch(e){case"search":this.focusSearch(!0);break;case"first":this.focusOptionByIndex(0);break;case"last":this.focusOptionByIndex(this.filteredOptions.length-1);break;case"selected":{this.focusOptionByIndex(this.selectedOptionIndex());break}}})}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusOptionByIndex(e){let i=this.optionElements();if(!i.length)return;let r=Math.max(0,Math.min(e,i.length-1));i[r]?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}optionElements(){return Array.from(this.shadowRoot?.querySelectorAll(".option")??[])}selectedOptionIndex(){let e=this.filteredOptions.findIndex(i=>i.value===this.value);return e>=0?e:0}resolveOptionVisuals(e){if(e.background||e.foreground||e.borderColor)return{background:Li("background",e.background)??"var(--_surface-subtle)",foreground:Li("color",e.foreground)??"var(--_text-primary)",borderColor:Li("border-color",e.borderColor)??"transparent"};switch(e.tone){case"teal":return{background:"#0b7280",foreground:"#ffffff",borderColor:"transparent"};case"green":return{background:"#176c27",foreground:"#ffffff",borderColor:"transparent"};case"olive":return{background:"#547d46",foreground:"#f5fbf2",borderColor:"transparent"};case"gold":return{background:"#8b6b24",foreground:"#fff7de",borderColor:"transparent"};case"blue":return{background:"#416b89",foreground:"#ffffff",borderColor:"transparent"};case"gray":return{background:"#606672",foreground:"#f6f7fa",borderColor:"transparent"};default:return{background:"color-mix(in srgb, var(--_surface-subtle) 90%, white)",foreground:"var(--_text-primary)",borderColor:"color-mix(in srgb, var(--_border-subtle) 80%, transparent)"}}}};c(Ve.prototype,"value");c({attribute:"control-label"})(Ve.prototype,"controlLabel");c(Ve.prototype,"placeholder");c({mode:"boolean"})(Ve.prototype,"invalid");c({attribute:"error-text"})(Ve.prototype,"errorText");c({attribute:"error-announcement"})(Ve.prototype,"errorAnnouncement");m(Ve.prototype,"options");m(Ve.prototype,"open");m(Ve.prototype,"filterQuery");customElements.get("violet-data-grid-pill-select")||await f.define(Ve,{name:"violet-data-grid-pill-select",template:ug,styles:dg,shadowOptions:{delegatesFocus:!0}});function Xi(t){let e=new Set,i=[];for(let r of t){let o=String(r??"").trim();!o||e.has(o)||(e.add(o),i.push(o))}return i}function Xd(t){if(Array.isArray(t))return Xi(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return Xi(i)}catch{}return Xi(e.split(/\s*,\s*/u))}function qo(t){return JSON.stringify(Xi(t))}var hg=0,Qd=2,pg=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_pill-font-size: var(--violet-data-grid-pill-font-size, 0.8125rem);
        --_size-font-md: var(--size-font-md, 14px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.7;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
        border-radius: var(--_radius-sm);
    }

    .trigger:disabled {
        cursor: not-allowed;
    }

    .selection {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.25rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .selection[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .references {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
    }

    .reference-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.375rem;
        padding-inline: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        border-radius: 999px;
        box-sizing: border-box;
        background: color-mix(in srgb, var(--_surface-subtle) 82%, white);
        color: var(--_text-primary);
        font-size: var(--_pill-font-size);
        line-height: 1;
    }

    .pill-label,
    .placeholder {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pill-dot {
        inline-size: 0.5rem;
        block-size: 0.5rem;
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--_border-subtle) 75%, transparent);
        box-sizing: border-box;
    }

    .overflow-pill {
        background: color-mix(in srgb, var(--_surface-subtle) 88%, white);
        border-color: color-mix(in srgb, var(--_border-subtle) 80%, transparent);
        color: var(--_text-secondary);
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: fixed;
        inset: unset;
        margin: 0;
        box-sizing: border-box;
        max-inline-size: calc(100vw - 16px);
        max-block-size: calc(100vh - 16px);
        overflow: auto;
        z-index: var(--_layer-popover);
        display: grid;
        gap: 0.5rem;
        inline-size: min(20rem, max(15rem, 100%));
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .selection-summary {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1.2;
        padding-inline: 0.125rem;
    }

    .listbox {
        --violet-listbox-min-inline-size: 100%;
        --violet-listbox-max-block-size: 13rem;
        --violet-listbox-padding: 0.25rem;
    }

    .option-token {
        inline-size: 1.5rem;
        block-size: 1.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: 999px;
        border: 1px solid transparent;
        box-sizing: border-box;
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 1;
        text-transform: uppercase;
    }

    .option-check {
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        font-weight: 700;
        line-height: 1;
    }

    .create-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 100%;
        min-block-size: 2rem;
        padding-inline: 0.75rem;
        border: 1px dashed color-mix(in srgb, var(--_border-strong) 45%, transparent);
        border-radius: calc(var(--_radius-md) - 2px);
        background: color-mix(in srgb, var(--_surface-subtle) 48%, white);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-sm);
        cursor: pointer;
    }

    .create-action:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }
`,fg=u`
    <div class="root" part="base">
        <span id="trigger-label" hidden>${t=>t.triggerLabel}</span>
        <button
            class="trigger"
            type="button"
            part="trigger"
            ?disabled="${t=>t.disabled}"
            aria-labelledby="${t=>t.triggerLabelledBy}"
            aria-haspopup="listbox"
            aria-controls="${t=>t.panelId}"
            aria-expanded="${t=>String(t.open)}"
            @click="${t=>(t.handleTriggerClick(),!0)}"
            @keydown="${(t,e)=>(t.handleTriggerKeydown(e.event),!0)}"
        >
            <span class="selection" id="trigger-value" part="selection" data-empty="${t=>String(t.selectedValues.length===0)}">
                <span class="references">
                    ${b(t=>t.selectedValues.length===0,u`
                            <span class="placeholder">${t=>t.placeholder||"Link records"}</span>
                        `)}
                    ${L(t=>t.visibleSelectedEntries,u`
                            <span class="reference-pill" part="pill">
                                <span class="pill-dot" style="${(t,e)=>e.parent.pillDotStyleForValue(t.value)}"></span>
                                <span class="pill-label">${t=>t.label}</span>
                            </span>
                        `)}
                    ${b(t=>t.overflowCount>0,u`
                            <span class="reference-pill overflow-pill" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${b(t=>t.open,u`
                <div class="panel" id="${t=>t.panelId}" part="panel" popover="manual"
                    @toggle="${(t,e)=>(t.handlePanelToggle(e.event),!0)}">
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find records"
                        aria-label="Find records"
                        aria-controls="${t=>t.listboxId}"
                        :value="${t=>t.filterQuery}"
                        @input="${(t,e)=>(t.handleSearchInput(e.event),!0)}"
                        @keydown="${(t,e)=>(t.handleSearchKeydown(e.event),!0)}"
                    />
                    <div class="selection-summary" part="selection-summary" role="status">${t=>t.selectionSummary}</div>
                            <violet-listbox
                                id="${t=>t.listboxId}"
                                class="listbox"
                                part="listbox"
                                ?multiple="${t=>t.multiple}"
                                ?disabled="${t=>t.disabled}"
                                aria-label="${t=>t.getAttribute("aria-label")||t.placeholder||"Records"}"
                                :value="${t=>t.selectedValues[0]??""}"
                                :selectedValues="${t=>t.selectedValues}"
                                @input="${(t,e)=>(t.handleListboxInput(e.event),!0)}"
                                @change="${(t,e)=>(t.handleListboxChange(e.event),!0)}"
                                @keydown="${(t,e)=>(t.handleListboxKeydown(e.event),!0)}"
                            >
                                ${L(t=>t.filteredOptions,u`
                                        <violet-option value="${t=>t.value}" label="${t=>t.label}">
                                            <span
                                                slot="before"
                                                class="option-token"
                                                style="${(t,e)=>e.parent.optionTokenStyle(t)}"
                                            >
                                                ${(t,e)=>e.parent.optionTokenText(t)}
                                            </span>
                                            ${b(t=>!!t.description,u`
                                                    <span slot="description">${t=>t.description}</span>
                                                `)}
                                            <span
                                                slot="after"
                                                class="option-check"
                                                ?hidden="${(t,e)=>!e.parent.isSelected(t.value)}"
                                            >Linked</span>
                                            ${t=>t.label}
                                        </violet-option>
                                    `)}
                            </violet-listbox>
                    ${b(t=>t.filteredOptions.length===0&&!t.hasCreateAction,u`
                            <div class="empty" part="empty-state" role="status">No matching records</div>
                        `)}
                    ${b(t=>t.hasCreateAction,u`
                            <button
                                class="create-action"
                                part="create-action"
                                type="button"
                                @keydown="${(t,e)=>(t.handleListboxKeydown(e.event),!0)}"
                                @click="${t=>(t.handleCreateAction(),!0)}"
                            >
                                ${t=>t.createActionText}
                            </button>
                        `)}
                </div>
            `)}
    </div>
`,Xe=class extends f{#e=++hg;#t="[]";#i=null;#r=0;#n=null;#s=null;#o=e=>{let i=this.panelElement();i&&!e.composedPath().includes(i)&&this.positionPanel()};#a=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#l=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let r=e.composedPath();if(e.type==="pointerup"&&r.includes(i)){let s=i.options.find(n=>r.includes(n));s&&!s.isDisabled&&(i.activeValue=s.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#c=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#d=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let r=this.listboxElement();e.button===0&&r&&!this.disabled&&i.includes(r)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.multiple=!0,this.allowCreate=!1,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#a),this.addEventListener("keydown",this.#c,!0),this.ownerDocument.addEventListener("pointerdown",this.#d,!0),this.ownerDocument.addEventListener("pointerup",this.#l,!0),this.ownerDocument.addEventListener("pointercancel",this.#l,!0)}disconnectedCallback(){this.close(!1),this.removeViewportListeners(),this.#r+=1,this.removeEventListener("focusout",this.#a),this.removeEventListener("keydown",this.#c,!0),this.ownerDocument.removeEventListener("pointerdown",this.#d,!0),this.ownerDocument.removeEventListener("pointerup",this.#l,!0),this.ownerDocument.removeEventListener("pointercancel",this.#l,!0),super.disconnectedCallback()}get value(){return qo(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Link records"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Link records")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get listboxId(){return`${this.panelId}-listbox`}disabledChanged(){this.disabled&&this.open&&this.close(!0)}handlePanelToggle(e){let i=this.panelElement();e.newState==="closed"&&i&&!i.matches(":popover-open")&&this.close(!0)}filterQueryChanged(){K.next().then(()=>this.positionPanel())}get selectedEntries(){return this.selectedValues.map(e=>{let i=Ui(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,Qd)}get overflowCount(){return Math.max(0,this.selectedValues.length-Qd)}get selectionSummary(){return this.selectedValues.length===0?"No linked records":`${this.selectedValues.length} linked record${this.selectedValues.length===1?"":"s"}`}get filteredOptions(){return Wi(this.options,this.filterQuery)}get hasCreateAction(){let e=this.normalizedQuery();return!this.allowCreate||!e?!1:!this.options.some(i=>{let r=i.label.trim().toLowerCase(),o=i.value.trim().toLowerCase();return r===e||o===e})}get createActionText(){return`Create "${this.filterQuery.trim()}"`}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel(e.key==="ArrowUp"?"last":"listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??"",this.$emit("query-change",{query:this.filterQuery})}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"||e.key==="ArrowUp"){if(e.preventDefault(),e.stopPropagation(),this.filteredOptions.length>0){this.focusListboxControl(e.key==="ArrowUp");return}this.hasCreateAction&&this.focusCreateAction();return}if(e.key==="Enter"&&this.hasCreateAction&&this.filteredOptions.length===0){e.preventDefault(),e.stopPropagation(),this.handleCreateAction();return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,r=new Set(this.filteredOptions.map(n=>n.value)),o=this.selectedValues.filter(n=>!r.has(n)),s=this.multiple?[...o,...i?.selectedValues??[]]:i?.value?[i.value]:[];this.applySelection(s,"input"),this.multiple||(this.close(!0),this.focusTrigger())}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}handleCreateAction(){let e=this.filterQuery.trim();this.disabled||!e||!this.hasCreateAction||this.$emit("create-request",{query:e})}toggleValue(e){if(this.disabled)return;if(!this.multiple){let r=this.selectedValues.length===1&&this.selectedValues[0]===e;this.applySelection(r?[]:[e],"input");return}let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}optionTokenStyle(e){let i=Ki(e);return`background:${i.background};color:${i.foreground};border-color:${i.borderColor};`}optionTokenText(e){let i=e.label.trim().split(/\s+/u).filter(Boolean);return i.length===0?"?":i.length===1?i[0].slice(0,2):`${i[0][0]??""}${i[1][0]??""}`}pillDotStyleForValue(e){let i=this.options.find(o=>o.value===e);return`background:${Ki(i??{label:e,value:e}).background};`}normalizedQuery(){return this.filterQuery.trim().toLowerCase()}syncSelectionFromValue(e){let i=Xd(e),r=this.multiple?i:i.slice(0,1);r.length===this.selectedValues.length&&r.every((o,s)=>o===this.selectedValues[s])||(this.selectedValues=r)}applySelection(e,i){let r=Xi(e);this.selectedValues=this.multiple?this.orderedSelectedValues(new Set(r)):r.slice(0,1),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(o=>e.has(o.value)).map(o=>o.value),r=[...e].filter(o=>!this.options.some(s=>s.value===o));return[...i,...r]}close(e){if(this.#s=null,!this.open)return;this.#r+=1;let i=qo(this.selectedValues),r=i!==this.#t;this.#i=null,this.open=!1;let o=this.panelElement();o?.matches(":popover-open")&&o.hidePopover(),this.removeViewportListeners(),this.filterQuery="",e&&r&&this.$emit("change",{value:i,selectedValues:[...this.selectedValues]})}openPanel(e){if(this.disabled)return;this.#r+=1,this.open||(this.#t=qo(this.selectedValues)),this.#i=e,this.open=!0;let i=this.getRootNode();this.#n=i instanceof ShadowRoot?i:null,this.#n?.addEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.addEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.addEventListener("resize",this.#o),this.queueOpenFocus()}queueOpenFocus(){let e=this.#r,i=this.#i;this.#i=null,i&&K.next().then(()=>{e!==this.#r||!this.open||!this.$fastController.isConnected||requestAnimationFrame(()=>{if(e!==this.#r||!this.open||!this.$fastController.isConnected)return;let r=this.panelElement();if(r&&!r.matches(":popover-open")&&r.showPopover(),this.positionPanel(),i!=="search"&&this.filteredOptions.length>0){this.focusListboxControl(i==="last");return}this.focusSearch(!0)})})}focusTrigger(){this.triggerElement()?.focus()}removeViewportListeners(){this.#n?.removeEventListener("scroll",this.#o,!0),this.#n=null,this.ownerDocument.defaultView?.removeEventListener("scroll",this.#o,!0),this.ownerDocument.defaultView?.removeEventListener("resize",this.#o)}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),r=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!r)return;let o=i.getBoundingClientRect(),s=8,n=6;e.style.inlineSize=`${Math.min(Math.max(o.width,288),r.innerWidth-s*2)}px`;let a=e.getBoundingClientRect(),l=Math.max(s,Math.min(o.left,r.innerWidth-a.width-s)),d=o.bottom+n,h=d+a.height<=r.innerHeight-s?d:o.top-a.height-n;e.style.left=`${l}px`,e.style.top=`${Math.max(s,Math.min(h,r.innerHeight-a.height-s))}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(e=!1){let i=this.listboxElement(),r=i?.shadowRoot?.querySelector('[role="listbox"]');i&&this.filteredOptions.length>0&&(i.activeValue=(e?this.filteredOptions.at(-1):this.filteredOptions[0])?.value??""),r?.focus()}focusCreateAction(){this.createActionElement()?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}createActionElement(){return this.shadowRoot?.querySelector(".create-action")}};c(Xe.prototype,"placeholder");c({mode:"boolean"})(Xe.prototype,"disabled");c({mode:"boolean"})(Xe.prototype,"multiple");c({mode:"boolean",attribute:"allow-create"})(Xe.prototype,"allowCreate");m(Xe.prototype,"selectedValues");m(Xe.prototype,"options");m(Xe.prototype,"open");m(Xe.prototype,"filterQuery");customElements.get("violet-data-grid-reference-picker")||await f.define(Xe,{name:"violet-data-grid-reference-picker",template:fg,styles:pg,shadowOptions:{delegatesFocus:!0}});function Nr(t){let e=Number(t);return Number.isFinite(e)?Math.min(10,Math.max(1,Math.round(e))):5}function Xt(t,e=5){if(t==null||typeof t=="string"&&t.trim()==="")return null;let i=Number(t);if(!Number.isFinite(i))return null;let r=Math.round(i);return r<=0?null:Math.min(Nr(e),r)}function Jd(t,e=5){let i=Xt(t,e);return i===null?"":String(i)}var Zd="M12 2.2 14.9 8.2 21.5 9.1 16.8 13.6 17.9 20 12 16.8 6.1 20 7.2 13.6 2.5 9.1 9.1 8.2 12 2.2Z",mg=v`
    ${F}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_rating-filled);
        font-family: var(--violet-data-grid-font-family, var(--font-family-body, "Montserrat", "Segoe UI", sans-serif));

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_rating-filled: var(--color-state-warning-text, #92400E);
        --_rating-empty: color-mix(in srgb, var(--_text-muted) 36%, transparent);
        --_rating-hover: color-mix(in srgb, var(--_rating-filled) 82%, var(--_surface-page));
        --_radius-md: var(--radius-md, 4px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.68;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .control {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding-inline: 0.125rem;
        border-radius: 999px;
        outline: none;
        user-select: none;
        -webkit-user-select: none;
    }

    .control[data-interactive="true"] {
        cursor: pointer;
    }

    .control[data-interactive="true"]:hover .star[data-filled="false"] {
        color: color-mix(in srgb, var(--_rating-empty) 70%, var(--_rating-hover));
    }

    .control:focus-visible {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 28%, transparent);
        background: color-mix(in srgb, var(--_surface-subtle) 52%, transparent);
    }

    .star {
        inline-size: 1.125rem;
        block-size: 1.125rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        color: var(--_rating-empty);
        transition:
            color var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .star[data-filled="true"] {
        color: var(--_rating-filled);
    }

    .control[data-interactive="true"] .star[data-filled="true"] {
        transform: translateY(-0.5px);
    }

    .star[data-current="true"] {
        transform: translateY(-1px) scale(1.02);
    }

    .star-shape {
        inline-size: 100%;
        block-size: 100%;
        fill: currentColor;
        stroke: color-mix(in srgb, currentColor 92%, var(--_surface-page));
        stroke-width: 1.25;
        vector-effect: non-scaling-stroke;
    }

    .summary {
        margin-inline-start: 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1;
        white-space: nowrap;
    }
`,gg=u`
    <div
        class="control"
        part="control"
        data-interactive="true"
        role="slider"
        tabindex="0"
        aria-label="${t=>t.controlLabel}"
        aria-valuemin="0"
        aria-valuemax="${t=>String(t.resolvedMax)}"
        aria-valuenow="${t=>String(t.rating??0)}"
        aria-valuetext="${t=>t.accessibleValueText}"
        @click="${(t,e)=>(t.handleControlClick(e.event),!0)}"
        @keydown="${(t,e)=>(t.handleControlKeydown(e.event),!0)}"
    >
        ${L(t=>t.starValues,u`
                <span
                    class="star"
                    part="star"
                    data-index="${t=>String(t)}"
                    data-filled="${(t,e)=>String(e.parent.isFilled(t))}"
                    data-current="${(t,e)=>String(e.parent.rating===t)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${Zd}"></path>
                    </svg>
                </span>
            `)}
        <span class="summary" part="summary">${t=>t.selectionSummary}</span>
    </div>
`,vg=u`
    <div
        class="control"
        part="control"
        data-interactive="false"
        role="img"
        aria-label="${t=>t.readonlyLabel}"
        aria-disabled="${t=>t.disabled?"true":null}"
    >
        ${L(t=>t.starValues,u`
                <span
                    class="star"
                    part="star"
                    data-index="${t=>String(t)}"
                    data-filled="${(t,e)=>String(e.parent.isFilled(t))}"
                    data-current="${(t,e)=>String(e.parent.rating===t)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${Zd}"></path>
                    </svg>
                </span>
            `)}
    </div>
`,bg=u`
    <div class="root" part="base">
        ${b(t=>t.interactive,gg,vg)}
    </div>
`,Qt=class extends f{constructor(){super(),this.disabled=!1,this.readonly=!1,this.ariaLabel="",this.rating=null,this.max=5}connectedCallback(){super.connectedCallback(),this.max=Nr(this.max),this.rating=Xt(this.rating,this.max)}ratingChanged(){let e=Xt(this.rating,this.max);e!==this.rating&&(this.rating=e)}maxChanged(){let e=Nr(this.max);if(e!==this.max){this.max=e;return}let i=Xt(this.rating,e);i!==this.rating&&(this.rating=i)}get value(){return Jd(this.rating,this.max)}set value(e){let i=Xt(e,this.max);i!==this.rating&&(this.rating=i)}focus(e){this.shadowRoot?.querySelector('.control[tabindex="0"]')?.focus(e)}get resolvedMax(){return Nr(this.max)}get starValues(){return Array.from({length:this.resolvedMax},(e,i)=>i+1)}get interactive(){return!this.disabled&&!this.readonly}get selectionSummary(){return this.rating===null?"No rating":`${this.rating}/${this.resolvedMax}`}get controlLabel(){return this.ariaLabel||"Rating"}get accessibleValueText(){return this.rating===null?`No rating, out of ${this.resolvedMax}`:`${this.rating} of ${this.resolvedMax}`}get readonlyLabel(){return`${this.controlLabel}: ${this.accessibleValueText}`}isFilled(e){return this.rating!==null&&e<=this.rating}selectRating(e){if(!this.interactive)return;let i=Xt(e,this.resolvedMax);i!==this.rating&&(this.rating=i,this.emitSelectionChange())}clearRating(){this.selectRating(null)}handleControlClick(e){if(!this.interactive)return;let i=e.composedPath().find(o=>o instanceof HTMLElement&&typeof o.dataset.index=="string");if(!i)return;let r=Xt(i.dataset.index,this.resolvedMax);this.selectRating(r!==null&&r===this.rating?null:r)}handleControlKeydown(e){if(this.interactive)switch(e.key){case"ArrowRight":case"ArrowUp":e.preventDefault(),this.selectRating(Math.min(this.resolvedMax,(this.rating??0)+1));break;case"ArrowLeft":case"ArrowDown":if(e.preventDefault(),this.rating===null)return;this.selectRating(this.rating>1?this.rating-1:null);break;case"Home":e.preventDefault(),this.selectRating(1);break;case"End":e.preventDefault(),this.selectRating(this.resolvedMax);break;case"Backspace":case"Delete":e.preventDefault(),this.clearRating();break;default:break}}emitSelectionChange(){let e={rating:this.rating,value:this.value};this.$emit("input",e),this.$emit("change",e)}};c({mode:"boolean"})(Qt.prototype,"disabled");c({mode:"boolean"})(Qt.prototype,"readonly");c({attribute:"aria-label",mode:"fromView"})(Qt.prototype,"ariaLabel");m(Qt.prototype,"rating");m(Qt.prototype,"max");customElements.get("violet-data-grid-rating")||await f.define(Qt,{name:"violet-data-grid-rating",template:bg,styles:mg,shadowOptions:{delegatesFocus:!0}});var eu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},jr=0;mr();var yg=v`
    ${F}

    :host {
        position: relative;
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: var(--_target-size);
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within,
    .control-shell.open .control-frame {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    .input {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
        outline: none;
    }

    .input::-webkit-calendar-picker-indicator {
        display: none;
    }

    .toggle {
        display: inline-grid;
        place-items: center;
        inline-size: calc(var(--_target-size) * 0.75);
        block-size: calc(var(--_target-size) * 0.75);
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--_radius-round, 9999px);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .toggle:hover {
        background: color-mix(in srgb, var(--_focus-ring) 10%, transparent);
    }

    .toggle:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    .icon {
        display: inline-grid;
        place-items: center;
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .display {
        display: none;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        padding: 0;
        border: 0;
        background: transparent;
    }

    .panel[hidden] {
        display: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within,
        .control-shell.open .control-frame {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        .toggle:focus-visible {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`,xg=u`
    <div class="field" part="field" @focusout="${(t,e)=>t.handleFocusOut(e.event)}">
        ${b(t=>!!t.label,u`<label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>`)}
        <div class="${t=>`control-shell${t.open?" open":""}`}" part="control-shell">
            <div class="control-frame" part="control-frame">
                <input
                    id="${t=>t.inputId}"
                    class="input"
                    part="input"
                    type="date"
                    name="${t=>t.name}"
                    :value="${t=>t.value}"
                    min="${t=>t.min}"
                    max="${t=>t.max}"
                    ?disabled="${t=>t.effectiveDisabled}"
                    ?required="${t=>t.required}"
                    aria-describedby="${t=>t.describedBy||null}"
                    aria-invalid="${t=>t.invalid?"true":"false"}"
                    @input="${(t,e)=>t.handleInput(e.event)}"
                    @change="${(t,e)=>t.handleCommit(e.event)}"
                    @keydown="${(t,e)=>t.handleInputKeydown(e.event)}"
                />
                <button
                    class="toggle"
                    part="toggle"
                    type="button"
                    ?disabled="${t=>t.effectiveDisabled}"
                    aria-label="${t=>t.value?"Change date":"Choose date"}"
                    aria-haspopup="dialog"
                    aria-expanded="${t=>String(t.open)}"
                    aria-controls="${t=>t.panelId}"
                    @click="${t=>t.toggleOpen()}"
                >
                    <span class="icon" aria-hidden="true">
                        <violet-icon icon="system/calendar" decorative></violet-icon>
                    </span>
                </button>
            </div>

            <div
                id="${t=>t.panelId}"
                class="panel"
                part="panel"
                hidden
                @keydown="${(t,e)=>t.handlePanelKeydown(e.event)}"
            >
                <violet-calendar
                    selection-mode="single"
                    locale="${t=>t.locale}"
                    value="${t=>t.value}"
                    min="${t=>t.min}"
                    max="${t=>t.max}"
                    @input="${(t,e)=>t.handleCalendarInput(e.event)}"
                    @change="${(t,e)=>t.handleCalendarChange(e.event)}"
                ></violet-calendar>
            </div>
        </div>
        ${b(t=>!!t.supportingText,u`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${b(t=>!!t.displayErrorText,u`<p class="error" part="error-message" id="${t=>t.errorId}">${t=>t.displayErrorText}</p>`)}
    </div>
`,se=class extends f{static{this.formAssociated=!0}#e;#t="";#i=()=>{this.open&&this.#c()};#r=!1;#n=e=>{let i=e.composedPath().includes(this);this.#r=i,this.open&&!i&&this.hide()};#s=()=>{this.#r=!1};constructor(){super(),this.#e=this.attachInternals(),this.open=!1,this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,this.min="",this.max="",this.locale="",this.size="natural",jr+=1,this.inputId=`violet-date-picker-input-${jr}`,this.supportingId=`violet-date-picker-supporting-${jr}`,this.errorId=`violet-date-picker-error-${jr}`,this.panelId=`violet-date-picker-panel-${jr}`}connectedCallback(){super.connectedCallback(),this.ownerDocument.addEventListener("pointerdown",this.#n,!0),this.ownerDocument.addEventListener("click",this.#s,!0),this.ownerDocument.addEventListener("pointercancel",this.#s,!0),this.ownerDocument.addEventListener("keydown",this.#s,!0),window.addEventListener("resize",this.#i),window.addEventListener("scroll",this.#i,!0),this.#t=this.value,this.#l(),this.#o(!1)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#n,!0),this.ownerDocument.removeEventListener("click",this.#s,!0),this.ownerDocument.removeEventListener("pointercancel",this.#s,!0),this.ownerDocument.removeEventListener("keydown",this.#s,!0),this.#r=!1,window.removeEventListener("resize",this.#i),window.removeEventListener("scroll",this.#i,!0),super.disconnectedCallback()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get displayValue(){return this.value?Fr(this.locale,this.value):""}get describedBy(){return[this.supportingText?this.supportingId:"",this.displayErrorText?this.errorId:""].filter(Boolean).join(" ")}get displayErrorText(){return this.validationMessageText||this.errorText}valueChanged(){this.#a(),this.#l()}invalidChanged(){this.#l()}errorTextChanged(){this.#l()}minChanged(){this.#l()}maxChanged(){this.#l()}openChanged(){this.#o(!0)}#o(e){if(!this.$fastController.isConnected)return;let i=this.panelElement;if(!i)return;i.hidden=!this.open,this.shadowRoot?.querySelector(".control-shell")?.classList.toggle("open",this.open),this.open&&(this.#c(),e&&requestAnimationFrame(()=>{this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]')?.focus()})),e&&this.$emit("open-change",{open:this.open})}handleInput(e){let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("change",{value:this.value})}handleInputKeydown(e){return this.effectiveDisabled?!0:e.key==="ArrowDown"?(e.preventDefault(),this.show(),!1):e.key==="Escape"&&this.open?(e.preventDefault(),this.hide(),!1):!0}handlePanelKeydown(e){return e.key==="Escape"&&this.open?(e.preventDefault(),e.stopPropagation(),this.hide(),this.inputElement?.focus(),!1):!0}handleFocusOut(e){let i=e.relatedTarget;return this.open&&!this.#r&&i instanceof Node&&i!==this&&!this.shadowRoot?.contains(i)&&this.hide(),!0}handleCalendarInput(e){e.stopPropagation()}handleCalendarChange(e){e.stopPropagation();let i=e.detail?.value??"";i&&(this.value=i,this.#l(),this.hide(),this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value}),this.inputElement?.focus())}show(){this.effectiveDisabled||(this.open=!0)}hide(){this.open=!1}toggleOpen(){this.open?this.hide():this.show()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#l()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get inputElement(){return this.shadowRoot?.querySelector(".input")}get panelElement(){return this.shadowRoot?.querySelector(".panel")}get calendarElement(){return this.shadowRoot?.querySelector("violet-calendar")}#a(){let e=this.inputElement;e&&e.value!==this.value&&(e.value=this.value)}#l(){let e=this.inputElement,i=this.required&&!this.value,r=this.invalid?this.errorText||"Select a valid date.":"",o=this.value?!ze(this.value):!1,s=this.value&&!o,n=!!(s&&ze(this.min)&&this.value<this.min),a=!!(s&&ze(this.max)&&this.value>this.max);this.validationMessageText=r||(i?"Please choose a date.":o?"Enter a valid date.":n?`Choose a date on or after ${this.min}.`:a?`Choose a date on or before ${this.max}.`:""),this.#e.setFormValue(this.value||null),this.#e.setValidity({valueMissing:i,customError:!!r,badInput:o,rangeUnderflow:n,rangeOverflow:a},this.validationMessageText,e??void 0)}#c(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".control-frame");if(!e||!i)return;let r=i.getBoundingClientRect(),o=Math.max(r.width,280);e.style.inlineSize=`${o}px`,e.style.left=`${Math.max(4,Math.min(r.left,window.innerWidth-o-4))}px`,e.style.top=`${Math.min(r.bottom+4,window.innerHeight-320)}px`}};eu([m],se.prototype,"open",void 0);eu([m],se.prototype,"validationMessageText",void 0);c({mode:"boolean"})(se.prototype,"open");c(se.prototype,"label");c({attribute:"supporting-text"})(se.prototype,"supportingText");c({attribute:"error-text"})(se.prototype,"errorText");c(se.prototype,"value");c(se.prototype,"name");c({mode:"boolean"})(se.prototype,"required");c({mode:"boolean"})(se.prototype,"disabled");q(se.prototype);c({mode:"boolean"})(se.prototype,"invalid");c(se.prototype,"min");c(se.prototype,"max");c(se.prototype,"locale");c(se.prototype,"size");customElements.get("violet-date-picker")||await f.define(se,{name:"violet-date-picker",template:xg,styles:yg});var wg=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Qi=0;mr();var _g=v`
    ${F}

    :host {
        position: relative;
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .trigger {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: var(--_target-size);
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        border-color: var(--_field-border-hover);
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .segment {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .segment.placeholder {
        color: var(--_text-muted);
    }

    .separator {
        color: var(--_text-muted);
    }

    .icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        padding: 0;
        border: 0;
        background: transparent;
    }

    .panel[hidden] {
        display: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .trigger {
            border-color: ButtonText;
        }

        .trigger:focus-visible,
        .control-shell.open .trigger {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .trigger {
            border-color: GrayText;
        }
    }
`,kg=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`<div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>`)}
        <div class="${t=>`control-shell${t.open?" open":""}`}" part="control-shell">
            <button
                id="${t=>t.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${t=>t.disabled}"
                aria-haspopup="dialog"
                aria-expanded="${t=>String(t.open)}"
                aria-controls="${t=>t.panelId}"
                aria-labelledby="${t=>t.labelledBy}"
                aria-describedby="${t=>t.describedBy||null}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @click="${t=>t.toggleOpen()}"
                @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
            >
                <span class="${t=>`segment${t.start?"":" placeholder"}`}">${t=>t.startDisplay}</span>
                <span class="separator" aria-hidden="true">-</span>
                <span class="${t=>`segment${t.end?"":" placeholder"}`}">${t=>t.endDisplay}</span>
                <span class="icon" aria-hidden="true">
                    <violet-icon icon="system/calendar" decorative></violet-icon>
                </span>
            </button>

            <div
                id="${t=>t.panelId}"
                class="panel"
                part="panel"
                hidden
                @keydown="${(t,e)=>t.handlePanelKeydown(e.event)}"
            >
                <violet-calendar
                    selection-mode="range"
                    locale="${t=>t.locale}"
                    start="${t=>t.start}"
                    end="${t=>t.end}"
                    min="${t=>t.min}"
                    max="${t=>t.max}"
                    @change="${(t,e)=>t.handleCalendarChange(e.event)}"
                ></violet-calendar>
            </div>
        </div>
        ${b(t=>!!t.supportingText,u`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${b(t=>!!t.displayErrorText,u`<p class="error" part="error-message" id="${t=>t.errorId}">${t=>t.displayErrorText}</p>`)}
    </div>
`,ue=class extends f{#e=()=>{this.open&&this.#r()};#t=e=>{this.open&&(e.composedPath().includes(this)||this.hide())};constructor(){super(),this.open=!1,this.label="",this.supportingText="",this.errorText="",this.start="",this.end="",this.min="",this.max="",this.locale="",this.required=!1,this.disabled=!1,this.invalid=!1,this.size="natural",Qi+=1,this.triggerId=`violet-date-range-picker-trigger-${Qi}`,this.labelId=`violet-date-range-picker-label-${Qi}`,this.supportingId=`violet-date-range-picker-supporting-${Qi}`,this.errorId=`violet-date-range-picker-error-${Qi}`,this.panelId=`violet-date-range-picker-panel-${Qi}`}connectedCallback(){super.connectedCallback(),this.ownerDocument.addEventListener("pointerdown",this.#t,!0),window.addEventListener("resize",this.#e),window.addEventListener("scroll",this.#e,!0),this.#i(!1)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#t,!0),window.removeEventListener("resize",this.#e),window.removeEventListener("scroll",this.#e,!0),super.disconnectedCallback()}get value(){return{start:this.start||null,end:this.end||null}}get labelledBy(){return this.label?`${this.labelId} ${this.triggerId}`:this.triggerId}get describedBy(){return[this.supportingText?this.supportingId:"",this.displayErrorText?this.errorId:""].filter(Boolean).join(" ")}get displayErrorText(){return this.invalid?this.errorText||"Choose a valid date range.":this.required&&(!this.start||!this.end)?this.errorText||"Please choose a start and end date.":this.errorText}get startDisplay(){return this.start?Fr(this.locale,this.start):"Start date"}get endDisplay(){return this.end?Fr(this.locale,this.end):"End date"}openChanged(){this.#i(!0)}#i(e){if(!this.$fastController.isConnected)return;let i=this.panelElement;i&&(i.hidden=!this.open,this.open&&(this.#r(),e&&requestAnimationFrame(()=>{this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]')?.focus()})),e&&this.$emit("open-change",{open:this.open}))}toggleOpen(){this.disabled||(this.open?this.hide():this.show())}show(){this.disabled||(this.open=!0)}hide(){this.open=!1}handleTriggerKeydown(e){return this.disabled?!0:e.key==="ArrowDown"||e.key==="Enter"||e.key===" "?(e.preventDefault(),this.show(),!1):e.key==="Escape"&&this.open?(e.preventDefault(),this.hide(),!1):!0}handlePanelKeydown(e){return e.key==="Escape"&&this.open?(e.preventDefault(),e.stopPropagation(),this.hide(),this.shadowRoot?.getElementById(this.triggerId)?.focus(),!1):!0}handleCalendarChange(e){e.stopPropagation(),this.start=e.detail?.start??"",this.end=e.detail?.end??"",this.$emit("input",this.value),this.$emit("change",this.value),this.start&&this.end&&(this.hide(),this.shadowRoot?.getElementById(this.triggerId)?.focus())}checkValidity(){return!(this.invalid||this.required&&(!this.start||!this.end)||this.start&&this.end&&this.start>this.end)}get panelElement(){return this.shadowRoot?.querySelector(".panel")}get calendarElement(){return this.shadowRoot?.querySelector("violet-calendar")}#r(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".trigger");if(!e||!i)return;let r=i.getBoundingClientRect(),o=Math.max(r.width,320);e.style.inlineSize=`${o}px`,e.style.left=`${Math.max(4,Math.min(r.left,window.innerWidth-o-4))}px`,e.style.top=`${Math.min(r.bottom+4,window.innerHeight-360)}px`}};wg([m],ue.prototype,"open",void 0);c({mode:"boolean"})(ue.prototype,"open");c(ue.prototype,"label");c({attribute:"supporting-text"})(ue.prototype,"supportingText");c({attribute:"error-text"})(ue.prototype,"errorText");c(ue.prototype,"start");c(ue.prototype,"end");c(ue.prototype,"min");c(ue.prototype,"max");c(ue.prototype,"locale");c({mode:"boolean"})(ue.prototype,"required");c({mode:"boolean"})(ue.prototype,"disabled");c({mode:"boolean"})(ue.prototype,"invalid");c(ue.prototype,"size");customElements.get("violet-date-range-picker")||await f.define(ue,{name:"violet-date-range-picker",template:kg,styles:_g});var Cg=v`
    ${E}

    :host {
        display: block;
        --_divider-color: var(--_border-subtle);
        --_divider-thickness: 1px;
        --_divider-min-block-size: 1.5rem;
    }

    :host([appearance="strong"]) {
        --_divider-color: color-mix(in srgb, var(--_border-subtle) 45%, var(--_text-secondary));
    }

    :host([orientation="vertical"]) {
        display: inline-flex;
        align-self: stretch;
    }

    .rule {
        margin: 0;
        border: 0;
        background: var(--_divider-color);
        color: inherit;
        flex: none;
    }

    .rule.horizontal {
        display: block;
        inline-size: 100%;
        block-size: var(--_divider-thickness);
    }

    .rule.vertical {
        display: block;
        inline-size: var(--_divider-thickness);
        min-block-size: var(--_divider-min-block-size);
        block-size: 100%;
    }

    @media (forced-colors: active) {
        .rule {
            forced-color-adjust: none;
            background: ButtonText;
        }
    }
`,zg=u`
    ${b(t=>t.orientation==="vertical",u`
            <div
                class="rule vertical"
                part="rule"
                role="${t=>t.decorative?"presentation":"separator"}"
                aria-hidden="${t=>t.decorative?"true":"false"}"
                aria-orientation="${t=>t.decorative?null:"vertical"}"
            ></div>
        `)}
    ${b(t=>t.orientation!=="vertical",u`
            <hr class="rule horizontal" part="rule" aria-hidden="${t=>t.decorative?"true":"false"}" />
        `)}
`,Ji=class extends f{constructor(){super(),this.appearance="subtle",this.orientation="horizontal",this.decorative=!1}};c(Ji.prototype,"appearance");c(Ji.prototype,"orientation");c({mode:"boolean"})(Ji.prototype,"decorative");customElements.get("violet-divider")||await f.define(Ji,{name:"violet-divider",template:zg,styles:Cg});var Sg=v`
    ${E}

    :host {
        display: inline;
        --_text-font-size: var(--_body-size);
        --_text-line-height: var(--_body-line);
        --_text-font-weight: var(--type-body-md-weight, 400);
        --_text-color: var(--_text-primary);
    }

    :host([variant="label"]) {
        --_text-font-size: var(--type-label-sm-size, 12px);
        --_text-line-height: var(--type-label-sm-line, 16px);
        --_text-font-weight: var(--type-label-sm-weight, 500);
    }

    :host([variant="caption"]) {
        --_text-font-size: var(--_caption-size);
        --_text-line-height: var(--_caption-line);
        --_text-font-weight: var(--type-caption-xs-weight, 500);
    }

    :host([variant="title-sm"]) {
        --_text-font-size: var(--type-title-sm-size, 18px);
        --_text-line-height: var(--type-title-sm-line, 24px);
        --_text-font-weight: var(--type-title-sm-weight, 600);
    }

    :host([variant="title-md"]) {
        --_text-font-size: var(--type-title-md-size, 24px);
        --_text-line-height: var(--type-title-md-line, 32px);
        --_text-font-weight: var(--type-title-md-weight, 600);
    }

    :host([tone="secondary"]) {
        --_text-color: var(--_text-secondary);
    }

    :host([tone="muted"]) {
        --_text-color: var(--_text-muted);
    }

    :host([tone="success"]) {
        --_text-color: var(--color-state-success-text);
    }

    :host([tone="warning"]) {
        --_text-color: var(--color-state-warning-text);
    }

    :host([tone="danger"]) {
        --_text-color: var(--color-state-danger-text);
    }

    .root {
        margin: 0;
        color: var(--_text-color);
        font-family: inherit;
        font-size: var(--_text-font-size);
        font-weight: var(--_text-font-weight);
        line-height: var(--_text-line-height);
        letter-spacing: normal;
    }

    .root.truncate {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .inline {
        display: inline;
    }

    .block {
        display: block;
    }
`,Et=t=>`root ${t.as==="span"||t.as==="small"||t.as==="strong"||t.as==="label"?"inline":"block"}${t.truncate?" truncate":""}`,$g=u`
    ${b(t=>t.as==="p",u`<p class="${Et}"><slot></slot></p>`)}
    ${b(t=>t.as==="small",u`<small class="${Et}"><slot></slot></small>`)}
    ${b(t=>t.as==="strong",u`<strong class="${Et}"><slot></slot></strong>`)}
    ${b(t=>t.as==="label",u`<label class="${Et}"><slot></slot></label>`)}
    ${b(t=>t.as==="h1",u`<h1 class="${Et}"><slot></slot></h1>`)}
    ${b(t=>t.as==="h2",u`<h2 class="${Et}"><slot></slot></h2>`)}
    ${b(t=>t.as==="h3",u`<h3 class="${Et}"><slot></slot></h3>`)}
    ${b(t=>t.as==="h4",u`<h4 class="${Et}"><slot></slot></h4>`)}
    ${b(t=>t.as==="span",u`<span class="${Et}"><slot></slot></span>`)}
`,di=class extends f{constructor(){super(),this.as="span",this.variant="body",this.tone="default",this.truncate=!1}};c(di.prototype,"as");c(di.prototype,"variant");c(di.prototype,"tone");c({mode:"boolean"})(di.prototype,"truncate");customElements.get("violet-text")||await f.define(di,{name:"violet-text",template:$g,styles:Sg,shadowOptions:{delegatesFocus:!0}});var tu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Eg=v`
    ${E}

    :host {
        display: block;
        --_empty-padding: var(--_space-lg);
        --_empty-gap: var(--_space-md);
        --_empty-background: transparent;
        --_empty-border: transparent;
        --_empty-shadow: none;
        --_empty-align: center;
    }

    :host([appearance="subtle"]) {
        --_empty-background: color-mix(in srgb, var(--_surface-subtle) 60%, var(--_surface-card));
        --_empty-border: transparent;
    }

    :host([appearance="outline"]) {
        --_empty-background: transparent;
        --_empty-border: var(--_border-subtle);
    }

    :host([orientation="horizontal"]) {
        --_empty-align: start;
    }

    .root {
        box-sizing: border-box;
        display: grid;
        gap: var(--_empty-gap);
        justify-items: var(--_empty-align);
        padding: var(--_empty-padding);
        border: 1px solid var(--_empty-border);
        border-radius: var(--_radius-lg);
        background: var(--_empty-background);
        box-shadow: var(--_empty-shadow);
        text-align: var(--_empty-align);
    }

    :host([orientation="horizontal"]) .root {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        text-align: start;
    }

    .media {
        display: grid;
        justify-items: inherit;
        min-inline-size: 0;
    }

    .media[hidden] {
        display: none;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-sm);
        min-inline-size: 0;
    }

    .heading,
    .message {
        justify-self: inherit;
    }

    .heading[hidden],
    .message[hidden],
    .actions[hidden] {
        display: none;
    }

    .body-slot::slotted(*) {
        margin: 0;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-sm);
        justify-content: inherit;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`,Tg=u`
    <div class="root" part="root">
        <div class="media" part="media" ?hidden="${t=>!t.hasMedia}">
            <slot name="media" @slotchange="${t=>t.handleMediaSlotChange()}"></slot>
        </div>
        <div class="body" part="body">
            <violet-text class="heading" part="heading" as="h3" variant="title-sm" ?hidden="${t=>!t.heading}">
                ${t=>t.heading}
            </violet-text>
            <violet-text class="message" part="message" as="p" variant="body" tone="secondary" ?hidden="${t=>!t.message}">
                ${t=>t.message}
            </violet-text>
            <slot class="body-slot" @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            <div class="actions" part="actions" ?hidden="${t=>!t.hasActions}">
                <slot name="actions" @slotchange="${t=>t.handleActionsSlotChange()}"></slot>
            </div>
        </div>
    </div>
`,Tt=class extends f{constructor(){super(),this.hasMedia=!1,this.hasActions=!1,this.heading="",this.message="",this.appearance="plain",this.orientation="vertical"}handleMediaSlotChange(){this.hasMedia=this.#e('slot[name="media"]')}handleActionsSlotChange(){this.hasActions=this.#e('slot[name="actions"]')}handleDefaultSlotChange(){}#e(e){return(this.shadowRoot?.querySelector(e)?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0)}};tu([m],Tt.prototype,"hasMedia",void 0);tu([m],Tt.prototype,"hasActions",void 0);c(Tt.prototype,"heading");c(Tt.prototype,"message");c(Tt.prototype,"appearance");c(Tt.prototype,"orientation");customElements.get("violet-empty-state")||await f.define(Tt,{name:"violet-empty-state",template:Tg,styles:Eg});var Ig=v`
    ${E}

    :host {
        display: inline-flex;
        --_spinner-size: var(--_target-size-compact, 24px);
        --_spinner-track: color-mix(in srgb, var(--_border-subtle) 65%, transparent);
        --_spinner-stroke: 2px;
    }

    :host([size="sm"]) {
        --_spinner-size: var(--_target-size-compact, 24px);
    }

    :host([size="md"]) {
        --_spinner-size: var(--_target-size-natural, 32px);
    }

    :host([size="lg"]) {
        --_spinner-size: var(--_target-size-comfortable, 44px);
        --_spinner-stroke: 3px;
    }

    .spinner {
        box-sizing: border-box;
        inline-size: var(--_spinner-size);
        block-size: var(--_spinner-size);
        border-radius: var(--_radius-round);
        border: var(--_spinner-stroke) solid var(--_spinner-track);
        border-block-start-color: currentColor;
        animation: spin 0.8s linear infinite;
        color: var(--_text-secondary);
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 1.6s;
        }
    }

    @media (forced-colors: active) {
        .spinner {
            forced-color-adjust: none;
            color: Highlight;
            border-color: GrayText;
            border-block-start-color: Highlight;
        }
    }
`,Ag=u`
    <span
        class="spinner"
        part="spinner"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
        aria-label="${t=>t.decorative?null:t.accessibleLabel}"
    ></span>
`,Zi=class extends f{constructor(){super(),this.label="",this.decorative=!1,this.size="md"}get accessibleLabel(){return R.trackVolatile(),this.label||"Loading"}};c(Zi.prototype,"label");c({mode:"boolean"})(Zi.prototype,"decorative");c(Zi.prototype,"size");customElements.get("violet-spinner")||await f.define(Zi,{name:"violet-spinner",template:Ag,styles:Ig});var Rg=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},iu=0;Be();function Cn(t){return t instanceof HTMLElement&&t.tagName.toLowerCase()==="violet-tree-item"}var Fg=v`
    ${F}

    :host {
        display: block;
        outline: none;

        --_tree-level: 1;
        --_tree-indent-step: var(--violet-tree-indent-step, 1rem);
        --_tree-row-radius: var(--violet-tree-row-radius, var(--_radius-md));
        --_tree-row-gap: var(--violet-tree-row-gap, var(--_space-inline-md));
        --_tree-row-padding-inline: var(--violet-tree-row-padding-inline, var(--_space-inline-md));
        --_tree-row-padding-block: var(--violet-tree-row-padding-block, var(--_space-stack-2xs));
        --_tree-row-background-selected:
            var(--violet-tree-row-background-selected, color-mix(in srgb, var(--_surface-subtle) 76%, white));
        --_tree-row-background-hover: var(--violet-tree-row-background-hover, var(--_surface-subtle));
        --_tree-row-border-selected: var(--violet-tree-row-border-selected, var(--_border-subtle));
        --_tree-toggle-size: var(--violet-tree-toggle-size, 0.875rem);
    }

    .row {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_tree-row-gap);
        min-block-size: var(--_target-size);
        padding-block: var(--_tree-row-padding-block);
        padding-inline-end: var(--_tree-row-padding-inline);
        padding-inline-start: calc(
            var(--_tree-row-padding-inline) + (var(--_tree-level, 1) - 1) * var(--_tree-indent-step)
        );
        border-radius: var(--_tree-row-radius);
        color: var(--color-text-primary, #18181b);
        cursor: pointer;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard);
    }

    .row:hover {
        background: var(--_tree-row-background-hover);
    }

    :host([selected]) .row {
        background: var(--_tree-row-background-selected);
        box-shadow: inset 0 0 0 1px var(--_tree-row-border-selected);
    }

    :host(:focus-visible) .row {
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    :host([selected]:focus-visible) .row {
        box-shadow:
            inset 0 0 0 1px var(--_tree-row-border-selected),
            inset 0 0 0 3px var(--_focus-ring);
    }

    :host([disabled]) .row {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.75;
    }

    .toggle {
        inline-size: var(--_tree-toggle-size);
        block-size: var(--_tree-toggle-size);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--_radius-md);
        color: var(--_text-secondary);
        user-select: none;
    }

    :host(:not([aria-expanded])) .toggle {
        opacity: 0;
    }

    .toggle-icon {
        --violet-icon-size: 0.75rem;
        transition: transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([expanded]) .toggle-icon {
        transform: rotate(90deg);
    }

    .label {
        min-inline-size: 0;
        color: inherit;
    }

    .meta {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .group {
        display: grid;
        gap: 0;
    }

    .group[hidden] {
        display: none;
    }

    ::slotted(violet-tree-item) {
        margin-block-start: 0;
    }

    @media (forced-colors: active) {
        .row {
            forced-color-adjust: none;
            color: ButtonText;
        }

        .row:hover,
        :host([selected]) .row {
            background: Canvas;
        }

        :host([selected]) .row {
            box-shadow: inset 0 0 0 1px Highlight;
        }

        :host(:focus-visible) .row {
            box-shadow: inset 0 0 0 2px Highlight;
        }
    }
`,Dg=u`
    <div class="row" part="row" @click="${(t,e)=>t.handleRowClick(e.event)}">
        <span
            class="toggle"
            part="toggle"
            aria-hidden="true"
            data-tree-toggle="true"
        >
            <violet-icon
                class="toggle-icon"
                part="toggle-icon"
                icon="system/chevron-right"
                decorative
                data-tree-toggle="true"
            ></violet-icon>
        </span>
        <slot name="start"></slot>
        <span class="label" part="label">
            <slot ${bo("labelSlot")}></slot>
        </span>
        <span class="meta" part="meta">
            <slot name="meta"></slot>
        </span>
    </div>
    <div class="group" part="group" role="group" ?hidden="${t=>!t.expanded||t.childItems.length===0}">
        <slot name="item" ${bo("itemSlot")} @slotchange="${t=>t.handleItemSlotChange()}"></slot>
    </div>
`,It=class extends f{#e;#t;#i=1;#r=1;#n=1;constructor(){super(),this.#e=`violet-tree-item-${iu}`,iu+=1,this.childItems=[],this.expanded=!1,this.expandable=!1,this.selected=!1,this.disabled=!1,this.value="",this.#t=new MutationObserver(()=>{this.syncStructureFromDom()})}connectedCallback(){super.connectedCallback(),this.hasAttribute("tabindex")||(this.tabIndex=-1),this.refreshNestingSlot(),this.id||=this.#e,this.#t.observe(this,{childList:!0}),queueMicrotask(()=>{this.syncStructureFromDom()}),this.#s()}disconnectedCallback(){this.#t.disconnect(),super.disconnectedCallback()}expandedChanged(){this.#s()}expandableChanged(){this.#s()}selectedChanged(){this.#s()}disabledChanged(){this.#s()}childItemsChanged(){this.#s()}get hasChildren(){return this.expandable||this.childItems.length>0}get parentItem(){return Cn(this.parentElement)?this.parentElement:null}get resolvedValue(){return this.value||this.textLabel}get textLabel(){return(this.labelSlot?.assignedNodes({flatten:!0})??[]).map(r=>r.textContent??"").join(" ").replace(/\s+/g," ").trim()||this.getAttribute("aria-label")||""}focusItem(){this.focus()}setActiveFromTree(e){this.tabIndex=e?0:-1}setTreePosition(e,i,r){this.#i=e,this.#r=i,this.#n=r,this.style.setProperty("--_tree-level",String(e)),this.#s()}refreshNestingSlot(){if(Cn(this.parentElement)){this.setAttribute("slot","item");return}this.getAttribute("slot")==="item"&&this.removeAttribute("slot")}handleItemSlotChange(){this.#o()}syncStructureFromDom(){this.#o();for(let e of this.childItems)e.syncStructureFromDom()}handleRowClick(e){if(this.disabled)return;if(e.composedPath().some(r=>r instanceof HTMLElement&&r.dataset.treeToggle==="true"&&this.hasChildren)){this.$emit("toggle-request",{expanded:!this.expanded});return}this.$emit("select-request",{value:this.resolvedValue})}#s(){this.isConnected&&(this.setAttribute("role","treeitem"),this.setAttribute("aria-level",String(this.#i)),this.setAttribute("aria-posinset",String(this.#r)),this.setAttribute("aria-setsize",String(this.#n)),this.setAttribute("aria-selected",String(this.selected)),this.disabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled"),this.hasChildren?this.setAttribute("aria-expanded",String(this.expanded)):this.removeAttribute("aria-expanded"))}#o(){this.childItems=Array.from(this.children).filter(Cn);for(let e of this.childItems)e.setAttribute("slot","item")}};Rg([m],It.prototype,"childItems",void 0);c({mode:"boolean"})(It.prototype,"expanded");c({mode:"boolean"})(It.prototype,"expandable");c({mode:"boolean"})(It.prototype,"selected");c({mode:"boolean"})(It.prototype,"disabled");c(It.prototype,"value");customElements.get("violet-tree-item")||await f.define(It,{name:"violet-tree-item",template:Dg,styles:Fg});var Mg=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},ru=0;function ou(t){return t instanceof HTMLElement&&t.tagName.toLowerCase()==="violet-tree-item"}function zn(t){return Array.isArray(t.childItems)?t.childItems:[]}var Og=v`
    ${F}

    :host {
        display: grid;

        --_tree-surface-padding: var(--violet-tree-surface-padding, var(--_space-stack-xs));
        --_tree-surface-radius: var(--violet-tree-surface-radius, calc(var(--_radius-md) * 2));
        --_tree-surface-background: var(--violet-tree-surface-background, var(--_surface-card));
        --_tree-surface-border: var(--violet-tree-surface-border, var(--_border-subtle));
    }

    .field {
        display: grid;
        gap: 0;
        min-inline-size: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-2xs);
    }

    .surface {
        min-inline-size: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
    }

    :host([appearance="framed"]) .surface {
        padding: var(--_tree-surface-padding);
        border: 1px solid var(--_tree-surface-border);
        border-radius: var(--_tree-surface-radius);
        background: var(--_tree-surface-background);
        box-shadow: var(--_shadow-control);
    }

    .tree {
        display: grid;
        gap: 0;
        outline: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }
    }
`,Lg=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
            `)}
        <div class="surface" part="surface">
            <div
                class="tree"
                part="tree"
                role="tree"
                aria-label="${t=>t.label?null:t.ariaLabel}"
                aria-labelledby="${t=>t.label?t.labelId:null}"
                aria-describedby="${t=>t.describedBy}"
            >
                <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
            </div>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingTextId}">
                    ${t=>t.supportingText}
                </p>
            `)}
        ${b(t=>!!t.errorText,u`
                <p class="error" part="error-text" id="${t=>t.errorTextId}">
                    ${t=>t.errorText}
                </p>
            `)}
    </div>
`,ut=class extends f{#e;#t=null;#i="";#r=0;#n=!1;constructor(){super(),this.#e=ru,ru+=1,this.rootItems=[],this.label="",this.supportingText="",this.errorText="",this.value="",this.ariaLabel="Tree",this.appearance="plain"}get labelId(){return`violet-tree-label-${this.#e}`}get supportingTextId(){return`violet-tree-supporting-${this.#e}`}get errorTextId(){return`violet-tree-error-${this.#e}`}get describedBy(){let e=[this.supportingText?this.supportingTextId:"",this.errorText?this.errorTextId:""].filter(Boolean);return e.length?e.join(" "):null}connectedCallback(){super.connectedCallback(),this.addEventListener("select-request",this.handleSelectRequest),this.addEventListener("toggle-request",this.handleToggleRequest),this.addEventListener("keydown",this.handleKeydown),this.addEventListener("focusin",this.handleFocusIn),queueMicrotask(()=>{this.handleSlotChange()})}disconnectedCallback(){this.removeEventListener("select-request",this.handleSelectRequest),this.removeEventListener("toggle-request",this.handleToggleRequest),this.removeEventListener("keydown",this.handleKeydown),this.removeEventListener("focusin",this.handleFocusIn),window.clearTimeout(this.#r),super.disconnectedCallback()}valueChanged(){if(this.#n)return;let e=this.#a().find(i=>i.resolvedValue===this.value)??null;this.#u(e,!1),this.#c()}handleSlotChange(){this.rootItems=this.#o();for(let r of this.rootItems)r.syncStructureFromDom();let e=this.#a(),i=this.value?e.find(r=>r.resolvedValue===this.value)??null:e.find(r=>r.selected)??null;i?this.#u(i,!1):e.length>0&&this.#u(null,!1),this.#c()}handleSelectRequest(e){let i=this.#h(e);!i||i.disabled||(this.#d(i,!0),this.#u(i,!0),this.#c())}handleToggleRequest(e){let i=this.#h(e);!i||i.disabled||!i.hasChildren||(this.#s(i,e.detail?.expanded??!i.expanded),this.#d(i,!0),this.#c())}handleFocusIn(e){let i=this.#h(e);!i||i.disabled||this.#d(i,!1)}handleKeydown(e){let i=this.#h(e)??this.#t??this.#l()[0]??null;if(!i)return;let r=this.#l(),o=r.indexOf(i);switch(Le(e.key,this)){case"ArrowDown":{let s=r[o+1];if(!s)return;e.preventDefault(),this.#d(s,!0);break}case"ArrowUp":{let s=r[o-1];if(!s)return;e.preventDefault(),this.#d(s,!0);break}case"ArrowRight":{if(e.preventDefault(),i.hasChildren&&!i.expanded){this.#s(i,!0),this.#c();return}if(i.hasChildren&&i.expanded){let s=i.childItems[0];s&&this.#d(s,!0)}break}case"ArrowLeft":{if(e.preventDefault(),i.hasChildren&&i.expanded){this.#s(i,!1),this.#c();return}let s=i.parentItem;s&&this.#d(s,!0);break}case"Home":{e.preventDefault();let s=r[0];s&&this.#d(s,!0);break}case"End":{e.preventDefault();let s=r.at(-1);s&&this.#d(s,!0);break}case"Enter":case" ":{e.preventDefault(),this.#u(i,!0),this.#c();break}default:{if(e.altKey||e.ctrlKey||e.metaKey||e.key.length!==1)return;this.#p(e.key,i);break}}}#s(e,i){e.expanded!==i&&(e.expanded=i,this.$emit("expanded-change",{value:e.resolvedValue,itemId:e.id,expanded:i}))}#o(){return(this.shadowRoot?.querySelector("slot")?.assignedElements()??[]).filter(ou)}#a(){let e=[],i=r=>{for(let o of r){e.push(o);let s=zn(o);s.length>0&&i(s)}};return i(this.rootItems),e}#l(){let e=[],i=r=>{for(let o of r){e.push(o);let s=zn(o);o.expanded&&s.length>0&&i(s)}};return i(this.rootItems),e}#c(){let e=(s,n)=>{s.forEach((a,l)=>{a.setTreePosition(n,l+1,s.length);let d=zn(a);d.length>0&&e(d,n+1)})};e(this.rootItems,1);let i=this.#l(),r=this.#a().find(s=>s.selected)??null;(!this.#t||!i.includes(this.#t))&&(this.#t=r&&i.includes(r)?r:i[0]??null);let o=this.#a();for(let s of o)s.setActiveFromTree(s===this.#t)}#d(e,i){this.#t=e;for(let r of this.#a())r.setActiveFromTree(r===e);i&&e.focusItem()}#u(e,i){let r=this.#a(),o=e&&!e.disabled?e:null;for(let s of r)s.selected=s===o;this.#n=!0,this.value=o?.resolvedValue??"",this.#n=!1,i&&o&&this.$emit("change",{value:o.resolvedValue,itemId:o.id})}#h(e){return e.composedPath().find(ou)??null}#p(e,i){let r=this.#l();if(r.length===0)return;this.#i+=e.toLowerCase(),window.clearTimeout(this.#r),this.#r=window.setTimeout(()=>{this.#i=""},400);let o=Math.max(r.indexOf(i),0);for(let s=1;s<=r.length;s+=1){let n=r[(o+s)%r.length];if(n.textLabel.toLowerCase().startsWith(this.#i)){this.#d(n,!0);return}}}};Mg([m],ut.prototype,"rootItems",void 0);c(ut.prototype,"label");c({attribute:"supporting-text"})(ut.prototype,"supportingText");c({attribute:"error-text"})(ut.prototype,"errorText");c(ut.prototype,"value");c({attribute:"aria-label",mode:"fromView"})(ut.prototype,"ariaLabel");c(ut.prototype,"appearance");customElements.get("violet-tree")||await f.define(ut,{name:"violet-tree",template:Lg,styles:Og});var G=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s};Ss();vt();var Hr="__violet-file-explorer-root__",Jt=class{constructor(e){this.value=e,this.name="",this.expanded=!1,this.expandable=!1,this.children=[]}};G([m],Jt.prototype,"value",void 0);G([m],Jt.prototype,"name",void 0);G([m],Jt.prototype,"expanded",void 0);G([m],Jt.prototype,"expandable",void 0);G([m],Jt.prototype,"children",void 0);var qr=class{constructor(e,i){this.id=e,this.name=i}};G([m],qr.prototype,"id",void 0);G([m],qr.prototype,"name",void 0);var Qe=class{constructor(e){this.id=e,this.name="",this.kind="file",this.meta="",this.icon="",this.selected=!1,this.disabled=!1,this.active=!1}get accessibleName(){return[this.name,this.meta,this.kind==="folder"?"folder":""].filter(Boolean).join(", ")}};G([m],Qe.prototype,"id",void 0);G([m],Qe.prototype,"name",void 0);G([m],Qe.prototype,"kind",void 0);G([m],Qe.prototype,"meta",void 0);G([m],Qe.prototype,"icon",void 0);G([m],Qe.prototype,"selected",void 0);G([m],Qe.prototype,"disabled",void 0);G([m],Qe.prototype,"active",void 0);var Vg=v`
    ${F}
    ${E}

    :host {
        display: block;
        container-type: inline-size;
        block-size: var(--violet-file-explorer-block-size, 24rem);
        min-inline-size: 0;

        --_explorer-nav-size: var(--violet-file-explorer-nav-inline-size, 14rem);
        --_explorer-radius: var(--violet-file-explorer-radius, var(--_radius-lg));
        --_explorer-padding: var(--violet-file-explorer-padding, var(--_space-stack-sm));
        --_row-radius: var(--violet-file-explorer-row-radius, var(--_radius-md));
        --_row-background-hover: var(--violet-file-explorer-row-background-hover, var(--_surface-subtle));
        --_row-background-selected: var(--violet-file-explorer-row-background-selected, var(--_surface-hover));
        --_row-border-selected: var(--violet-file-explorer-row-border-selected, var(--_border-subtle));
        --_danger-text: var(--color-state-danger-foreground, #b42318);
    }

    .explorer {
        box-sizing: border-box;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        block-size: 100%;
        min-block-size: 0;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_explorer-radius);
        background: var(--_surface-card);
        overflow: hidden;
    }

    .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-inline-md);
        padding: var(--_space-stack-xs) var(--_explorer-padding);
        border-block-end: 1px solid var(--_border-subtle);
        min-block-size: var(--_target-size);
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-inline-md);
        margin-inline-start: auto;
    }

    .body {
        display: grid;
        grid-template-columns: minmax(8rem, var(--_explorer-nav-size)) minmax(0, 1fr);
        min-block-size: 0;
    }

    violet-tree {
        --violet-tree-row-background-selected: var(--_row-background-selected);
        --violet-tree-row-background-hover: var(--_row-background-hover);
        --violet-tree-row-border-selected: var(--_row-border-selected);
    }

    .nav {
        min-inline-size: 0;
        min-block-size: 0;
        overflow: auto;
        padding: var(--_space-stack-xs);
        border-inline-end: 1px solid var(--_border-subtle);
    }

    .content {
        position: relative;
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
        min-block-size: 0;
        overflow: auto;
        padding: var(--_space-stack-xs);
        outline: none;
    }

    .list {
        display: grid;
        gap: 0;
        outline: none;
    }

    .row {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-md);
        min-block-size: var(--_target-size);
        padding-block: var(--_space-stack-2xs);
        padding-inline: var(--_space-inline-md);
        border-radius: var(--_row-radius);
        color: var(--_text-primary);
        cursor: pointer;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
        user-select: none;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .row:hover {
        background: var(--_row-background-hover);
    }

    .row[aria-selected="true"] {
        background: var(--_row-background-selected);
        box-shadow: inset 0 0 0 1px var(--_row-border-selected);
    }

    .row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .row[aria-selected="true"]:focus-visible {
        box-shadow:
            inset 0 0 0 1px var(--_row-border-selected),
            inset 0 0 0 3px var(--_focus-ring);
    }

    .row[aria-disabled="true"] {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.75;
    }

    .row-icon {
        --violet-icon-size: 1.125rem;
        color: var(--_text-secondary);
    }

    .name {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .meta {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        white-space: nowrap;
    }

    .state {
        display: grid;
        flex: 1;
        place-content: center;
        justify-items: center;
        gap: var(--_space-stack-sm);
        padding: var(--_space-stack-sm);
        color: var(--_text-secondary);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: center;
    }

    .state.loading {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        gap: var(--_space-inline-md);
    }

    .state.loading:only-child {
        flex: 1;
    }

    .error-message {
        margin: 0;
        color: var(--_danger-text);
    }

    .footer {
        padding: var(--_space-stack-xs) var(--_explorer-padding);
        border-block-start: 1px solid var(--_border-subtle);
    }

    .footer[hidden] {
        display: none;
    }

    .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    @container (max-width: 34rem) {
        .body {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, auto) minmax(0, 1fr);
        }

        .nav {
            max-block-size: 8rem;
            border-inline-end: 0;
            border-block-end: 1px solid var(--_border-subtle);
        }
    }

    @media (forced-colors: active) {
        .explorer {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
        }

        .row {
            forced-color-adjust: none;
            color: CanvasText;
        }

        .row[aria-selected="true"] {
            background: Canvas;
            box-shadow: inset 0 0 0 2px Highlight;
        }

        .row:focus-visible {
            box-shadow: inset 0 0 0 2px Highlight;
            outline: 2px solid Highlight;
        }
    }
`,su=u`
    <violet-tree-item
        value="${t=>t.value}"
        ?expanded="${t=>t.expanded}"
        ?expandable="${t=>t.expandable}"
    >
        <violet-icon slot="start" icon="system/folder" decorative></violet-icon>
        ${t=>t.name}
        ${L(t=>t.children,(t,e)=>su,{recycle:!1})}
    </violet-tree-item>
`,Pg=u`
    <violet-breadcrumb-item
        href="#"
        data-folder-id="${t=>t.id}"
        @click="${(t,e)=>e.parent.handleCrumbClick(t,e.event)}"
    >
        ${t=>t.name}
    </violet-breadcrumb-item>
`,Bg=u`
    <div
        class="row"
        part="row"
        role="option"
        data-item-id="${t=>t.id}"
        data-kind="${t=>t.kind}"
        tabindex="${t=>t.active?"0":"-1"}"
        aria-label="${t=>t.accessibleName}"
        aria-selected="${(t,e)=>e.parent.selectionMode==="none"?null:String(t.selected)}"
        aria-disabled="${t=>t.disabled?"true":null}"
        @click="${(t,e)=>e.parent.handleRowClick(t,e.event)}"
        @dblclick="${(t,e)=>e.parent.handleRowDoubleClick(t)}"
    >
        <violet-icon
            class="row-icon"
            part="row-icon"
            icon="${t=>t.icon}"
            decorative
        ></violet-icon>
        <span class="name" part="name">${t=>t.name}</span>
        <span class="meta" part="meta">${t=>t.meta}</span>
    </div>
`,Ng=u`
    <div class="explorer" part="explorer" role="group" aria-label="${t=>t.label||"File explorer"}">
        <div class="toolbar" part="toolbar">
            <violet-breadcrumb part="breadcrumb" label="Folder path">
                ${L(t=>t.crumbs,Pg,{recycle:!1})}
            </violet-breadcrumb>
            <div class="actions" part="actions">
                <slot name="actions"></slot>
            </div>
        </div>
        <div class="body" part="body">
            <div class="nav" part="navigation">
                <violet-tree
                    part="tree"
                    aria-label="Folders"
                    value="${t=>t.treeValue}"
                    @change="${(t,e)=>t.handleTreeChange(e.event)}"
                    @expanded-change="${(t,e)=>t.handleTreeExpandedChange(e.event)}"
                >
                    ${L(t=>t.folderTree,su,{recycle:!1})}
                </violet-tree>
            </div>
            <div
                class="content"
                part="content"
                tabindex="-1"
                aria-busy="${t=>t.isLoading?"true":"false"}"
            >
                ${b(t=>t.isLoading,u`
                        <div class="state loading" part="loading-state" role="status">
                            <violet-spinner size="sm" label="Loading folder contents"></violet-spinner>
                            <span>Loading…</span>
                        </div>
                    `)}
                ${b(t=>!!t.loadError,u`
                        <div class="state" part="error-state" role="alert">
                            <p class="error-message" part="error-text">${t=>t.loadError}</p>
                            <violet-button appearance="secondary" @click="${t=>t.handleRetry()}">
                                Try again
                            </violet-button>
                        </div>
                    `)}
                ${b(t=>t.isEmpty,u`
                        <div class="state" part="empty-state">
                            <slot name="empty">
                                <violet-empty-state
                                    heading="This folder is empty"
                                    appearance="plain"
                                ></violet-empty-state>
                            </slot>
                        </div>
                    `)}
                ${b(t=>t.rows.length>0&&!t.loadError,u`
                        <div
                            class="list"
                            part="list"
                            role="listbox"
                            aria-label="${t=>t.listLabel}"
                            aria-multiselectable="${t=>t.selectionMode==="multiple"?"true":null}"
                            @keydown="${(t,e)=>t.handleListKeydown(e.event)}"
                            @focusin="${(t,e)=>t.handleListFocusIn(e.event)}"
                        >
                            ${L(t=>t.rows,Bg,{recycle:!1})}
                        </div>
                    `)}
            </div>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter}">
            <slot name="footer" @slotchange="${(t,e)=>t.handleFooterSlotChange(e.event)}"></slot>
        </div>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${t=>t.statusMessage}</div>
    </div>
`,te=class extends f{#e=!1;#t=new Set([""]);#i=new Set;#r=new Map;#n=new Map;#s=new Map;#o="";#a="";#l=null;#c="";#d=!1;constructor(){super(),this.items=[],this.selectedIds=[],this.crumbs=[],this.folderTree=[],this.rows=[],this.statusMessage="",this.isLoading=!1,this.isEmpty=!1,this.treeValue=Hr,this.listLabel="Folder contents",this.hasFooter=!1,this.currentFolderId="",this.rootLabel="Files",this.selectionMode="single",this.busy=!1,this.loadError="",this.label=""}connectedCallback(){super.connectedCallback(),this.#e=!0,this.#y(),this.#m(this.currentFolderId,"navigate")}disconnectedCallback(){this.#e=!1,super.disconnectedCallback()}itemsChanged(){for(let e of[...this.#i])this.#u(e)?.loaded!==!1&&this.#i.delete(e);this.#b()}selectedIdsChanged(){this.#b()}currentFolderIdChanged(){this.#e&&(this.#f(this.currentFolderId),this.#b(),this.#m(this.currentFolderId,"navigate"))}rootLabelChanged(){this.#b()}selectionModeChanged(){this.#b()}busyChanged(){this.#b()}loadErrorChanged(){this.#b()}focusList(){this.#g()}handleFooterSlotChange(e){this.hasFooter=e.target.assignedNodes().length>0}handleCrumbClick(e,i){this.#x(e.id,{kind:"first"})}handleTreeChange(e){e.stopPropagation();let i=e.detail?.value;typeof i=="string"&&this.#x(i===Hr?"":i,null)}handleTreeExpandedChange(e){e.stopPropagation();let{value:i,expanded:r}=e.detail??{};if(typeof i!="string")return;let o=i===Hr?"":i;r?(this.#t.add(o),this.#m(o,"expand")):this.#t.delete(o);let s=this.#n.get(o);s&&(s.expanded=r)}handleRetry(){this.#i.delete(this.currentFolderId),this.#v(this.currentFolderId,"retry")}handleRowClick(e,i){if(!e.disabled){if(this.#A(e.id),this.selectionMode==="none"){this.#T(e.id);return}if(this.selectionMode==="multiple"&&i.shiftKey&&this.#a){this.#C(this.#a,e.id);return}if(this.selectionMode==="multiple"&&(i.ctrlKey||i.metaKey)){this.#B(e.id);return}this.#a=e.id,this.#_([e.id])}}handleRowDoubleClick(e){e.disabled||this.selectionMode==="none"||this.#T(e.id)}handleListFocusIn(e){let i=this.#D(e);return i&&this.#A(i),!0}handleListKeydown(e){let i=this.#D(e),r=this.rows,o=r.findIndex(l=>l.id===i);if(o<0||e.isComposing)return!0;let s=r[o],n=e.shiftKey&&this.selectionMode==="multiple",a=l=>{let d=r[Math.max(0,Math.min(r.length-1,l))];e.preventDefault(),d&&(n&&(this.#a||=s.id,this.#C(this.#a,d.id)),this.#N(d.id))};switch(e.key){case"ArrowDown":a(o+1);break;case"ArrowUp":a(o-1);break;case"Home":a(0);break;case"End":a(r.length-1);break;case"Enter":e.preventDefault(),s.disabled||this.#T(s.id);break;case" ":e.preventDefault(),!s.disabled&&this.selectionMode!=="none"&&(this.#a=s.id,this.selectionMode==="multiple"?this.#B(s.id):this.#_([s.id]));break;case"Escape":this.selectedIds.length>0&&this.selectionMode!=="none"&&(e.preventDefault(),this.#_([]));break;case"Backspace":this.#$(e);break;case"ArrowLeft":e.altKey&&this.#$(e);break;case"a":case"A":(e.ctrlKey||e.metaKey)&&this.selectionMode==="multiple"&&(e.preventDefault(),this.#_(r.filter(l=>!l.disabled).map(l=>l.id)));break;default:break}return!0}#u(e){return this.items.find(i=>i.id===e)}#h(e){return e.parentId??""}#p(e){let i=[],r=new Set,o=e;for(;o&&!r.has(o);){r.add(o),i.unshift(o);let s=this.#u(o);if(!s)break;o=this.#h(s)}return i}#f(e){this.#t.add("");for(let i of this.#p(e).slice(0,-1))this.#t.add(i)}#m(e,i){if(!e||this.#i.has(e))return;let r=this.#u(e);r?.kind==="folder"&&r.loaded===!1&&(this.#i.add(e),this.#v(e,i))}#v(e,i){this.$emit("folder-request",{folderId:e||null,reason:i})}#b(){!this.#e||this.#d||(this.#d=!0,queueMicrotask(()=>{this.#d=!1,this.#e&&this.#y()}))}#y(){let e=this.currentFolderId??"",i=this.#E(),r=this.#o,o=this.rows.findIndex(s=>s.id===r);this.#k(e),this.#w(e),this.#F(e),this.#S(e),this.#V(i,o,r)}#k(e){let i=[this.#R("",this.rootLabel||"Files")];for(let r of this.#p(e))i.push(this.#R(r,this.#u(r)?.name??r));this.crumbs=i}#R(e,i){let r=this.#s.get(e);return r||(r=new qr(e,i),this.#s.set(e,r)),r.name=i,r}#w(e){let i=this.items.filter(n=>n.kind==="folder"),r=new Map;for(let n of i){let a=this.#h(n),l=r.get(a)??[];l.push(n),r.set(a,l)}let o=new Set,s=(n,a)=>{let l=this.#n.get(n);l||(l=new Jt(n===""?Hr:n),this.#n.set(n,l));let d=n?this.#u(n):void 0,h=o.has(n)?[]:r.get(n)??[];return o.add(n),l.name=a,l.expandable=d?.loaded===!1,l.expanded=this.#t.has(n),l.children=h.map(p=>s(p.id,p.name)),o.delete(n),l};this.folderTree=[s("",this.rootLabel||"Files")],this.treeValue=e===""?Hr:e,K.next().then(()=>{let n=this.shadowRoot?.querySelector("violet-tree");n&&(n.value=this.treeValue,n.handleSlotChange())})}#F(e){let i=new Set(this.selectedIds),r=this.items.filter(a=>this.#h(a)===e),o=r.map(a=>{let l=this.#r.get(a.id);return l||(l=new Qe(a.id),this.#r.set(a.id,l)),l.name=a.name,l.kind=a.kind,l.meta=a.meta??"",l.icon=a.icon||(a.kind==="folder"?"system/folder":"system/document"),l.disabled=!!a.disabled,l.selected=this.selectionMode!=="none"&&i.has(a.id),l});for(let a of[...this.#r.keys()])r.some(l=>l.id===a)||this.#r.delete(a);o.some(a=>a.id===this.#o)||(this.#o=(o.find(a=>a.selected)??o[0])?.id??"");for(let a of o)a.active=a.id===this.#o;let s=e?this.#u(e):void 0,n=s?.kind==="folder"&&s.loaded===!1;this.isLoading=(this.busy||n)&&!this.loadError,this.isEmpty=o.length===0&&!this.isLoading&&!this.loadError,this.listLabel=`Contents of ${s?.name??(this.rootLabel||"Files")}`,this.rows=o}#S(e){let i=e?this.#u(e)?.name??e:this.rootLabel||"Files",r;if(this.loadError)r=`${i}: ${this.loadError}`;else if(this.isLoading)r=`Loading ${i}`;else if(this.isEmpty)r=`${i} is empty`;else{let o=this.rows.length;r=`${i}: ${o} ${o===1?"item":"items"}`}r!==this.#c&&(this.#c=r,this.statusMessage=r)}#_(e){let i=this.selectionMode==="single"?e.slice(-1):e,r=this.selectedIds;i.length===r.length&&i.every((o,s)=>o===r[s])||(this.selectedIds=i,this.$emit("selection-change",{selectedIds:i,items:i.map(o=>this.#u(o)).filter(o=>!!o)}))}#B(e){let i=this.selectedIds;this.#a=e,this.#_(i.includes(e)?i.filter(r=>r!==e):[...i,e])}#C(e,i){let r=this.rows,o=r.findIndex(l=>l.id===e),s=r.findIndex(l=>l.id===i);if(o<0||s<0)return;let[n,a]=o<=s?[o,s]:[s,o];this.#_(r.slice(n,a+1).filter(l=>!l.disabled).map(l=>l.id))}#T(e){let i=this.#u(e);if(!i||i.disabled)return;this.$emit("item-activate",{id:i.id,kind:i.kind,item:i})!==!1&&i.kind==="folder"&&this.#x(i.id,{kind:"first"})}#x(e,i){if(e===this.currentFolderId){i&&(this.#l=i,this.#b());return}this.selectedIds.length>0&&this.#_([]),this.#l=i,this.#a="",this.#o="",this.currentFolderId=e,this.$emit("folder-change",{folderId:e||null,path:this.#p(e)})}#$(e){let i=this.currentFolderId;if(!i)return;e.preventDefault();let r=this.#u(i);this.#x(r?this.#h(r):"",{kind:"id",id:i})}#I(){return this.shadowRoot?.querySelector(".list")??null}#L(e){let i=this.#I();return i?Array.from(i.querySelectorAll("[data-item-id]")).find(r=>r.dataset.itemId===e)??null:null}#D(e){for(let i of e.composedPath())if(i instanceof HTMLElement&&i.dataset.itemId!==void 0)return i.dataset.itemId;return""}#E(){let e=this.#I(),i=this.shadowRoot?.activeElement??null;return!!(e&&i&&e.contains(i))}#A(e){this.#o=e;for(let i of this.rows)i.active=i.id===e}#N(e){this.#A(e),this.#L(e)?.focus()}#g(){K.next().then(()=>{let e=this.#L(this.#o);if(e){e.focus();return}this.shadowRoot?.querySelector(".content")?.focus()})}#V(e,i,r){let o=this.#l;if(this.isLoading||(this.#l=null),o){let s=this.rows,n=o.kind==="id"?s.find(a=>a.id===o.id)??s[0]:s[0];n&&this.#A(n.id),this.isLoading?K.next().then(()=>this.shadowRoot?.querySelector(".content")?.focus()):this.#g();return}if(e&&!this.rows.some(s=>s.id===r)){let s=this.rows[Math.min(Math.max(i,0),this.rows.length-1)];s&&this.#A(s.id),this.#g();return}e&&this.#g()}};G([m],te.prototype,"items",void 0);G([m],te.prototype,"selectedIds",void 0);G([m],te.prototype,"crumbs",void 0);G([m],te.prototype,"folderTree",void 0);G([m],te.prototype,"rows",void 0);G([m],te.prototype,"statusMessage",void 0);G([m],te.prototype,"isLoading",void 0);G([m],te.prototype,"isEmpty",void 0);G([m],te.prototype,"treeValue",void 0);G([m],te.prototype,"listLabel",void 0);G([m],te.prototype,"hasFooter",void 0);c({attribute:"current-folder-id"})(te.prototype,"currentFolderId");c({attribute:"root-label"})(te.prototype,"rootLabel");c({attribute:"selection-mode"})(te.prototype,"selectionMode");c({mode:"boolean"})(te.prototype,"busy");c({attribute:"load-error"})(te.prototype,"loadError");c(te.prototype,"label");customElements.get("violet-file-explorer")||await f.define(te,{name:"violet-file-explorer",template:Ng,styles:Vg});var nu=v`
  ${E}

  :host {
    display: block;
    min-block-size: 0;
    block-size: 100%;
    container-type: inline-size;

    --_gantt-name-width: var(--violet-gantt-name-column-width, 16rem);
    --_gantt-row-height: 64px;
    --_gantt-header-height: 52px;
    --_gantt-work: var(--violet-gantt-work-background, #526b4e);
    --_gantt-work-text: var(--violet-gantt-work-foreground, #ffffff);
    --_gantt-window: var(--violet-gantt-window-background, #dde7da);
    --_gantt-window-text: var(--violet-gantt-window-foreground, #253823);
    --_gantt-actual: var(--violet-gantt-actual-border, #186f83);
    --_gantt-advisory: var(--violet-gantt-advisory-border, #9a6700);
    --_gantt-selection: var(--violet-gantt-selection-ring, #4b67b0);
    --_gantt-axis-size: var(--type-label-sm-size, 12px);
    --_gantt-axis-line: var(--type-label-sm-line, 16px);
    --_gantt-content-size: var(--violet-control-type-size, 13px);
    --_gantt-content-line: var(--type-label-sm-line, 16px);
    --_gantt-type-weight: var(--type-label-sm-weight, 500);
    --_gantt-expander-width: 24px;
    --_gantt-tree-gap: calc(var(--_space-sm) / 2);
  }

  :host([density="compact"]) {
    --_gantt-row-height: 36px;
  }

  :host([density="comfortable"]) {
    --_gantt-row-height: 76px;
  }

  .root {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    block-size: 100%;
    min-block-size: 0;
    overflow: hidden;
    border: 1px solid var(--_border-subtle);
    border-radius: var(--_radius-md);
    background: var(--_surface-card);
    color: var(--_text-primary);
    --_gantt-name-width: var(--violet-gantt-name-column-width, 16rem);
  }

  .toolbar[hidden] {
    display: none;
  }

  .toolbar {
    padding: var(--_space-sm);
    border-block-end: 1px solid var(--_border-subtle);
    background: var(--_surface-card);
  }

  .viewport {
    grid-row: 2;
    position: relative;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--_surface-page);
    scrollbar-gutter: stable;
    direction: ltr;
  }

  .grid {
    position: relative;
    min-inline-size: 100%;
  }

  .header,
  .row {
    display: grid;
    grid-template-columns: var(--_gantt-name-width) minmax(0, 1fr);
    min-inline-size: max-content;
  }

  .header {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--_layer-sticky);
    block-size: var(--_gantt-header-height);
    background: var(--_surface-card);
    border-block-end: 1px solid var(--_border-subtle);
  }

  .name-header,
  .row-header {
    position: sticky;
    left: 0;
    z-index: var(--_layer-raised);
    box-sizing: border-box;
    inline-size: var(--_gantt-name-width);
    background: var(--_surface-card);
    border-inline-end: 1px solid var(--_border-subtle);
  }

  .name-header {
    display: flex;
    align-items: center;
    padding-inline: calc(
        var(--_space-sm) + var(--_gantt-expander-width) + var(--_gantt-tree-gap)
      )
      var(--_space-sm);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    color: var(--_text-secondary);
  }

  .time-header,
  .chart {
    position: relative;
    direction: ltr;
    inline-size: var(--_gantt-chart-width);
    min-inline-size: var(--_gantt-chart-width);
  }

  .axis-context {
    position: absolute;
    inset-block-start: 4px;
    inset-inline-start: var(--_axis-context-left);
    z-index: 1;
    min-inline-size: 10rem;
    color: var(--_text-secondary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    white-space: nowrap;
    pointer-events: none;
  }

  .day {
    position: absolute;
    inset-block: 26px 0;
    inset-inline-start: var(--_day-left);
    box-sizing: border-box;
    inline-size: var(--_day-width);
    overflow: visible;
    color: var(--_text-primary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    white-space: nowrap;
  }

  .day.grid-boundary {
    box-shadow: inset 1px 0 0 var(--_border-subtle);
  }

  .day-label {
    display: block;
    box-sizing: border-box;
    inline-size: var(--_day-label-width);
    overflow: hidden;
    padding: 3px min(4px, calc(var(--_day-label-width) / 2));
    text-overflow: ellipsis;
  }

  .day-label:empty {
    display: none;
  }

  .body {
    position: relative;
    block-size: var(--_gantt-body-height);
    min-inline-size: max-content;
  }

  .body-grid {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--_gantt-name-width);
    inline-size: var(--_gantt-chart-width);
    overflow: hidden;
    pointer-events: none;
  }

  .grid-line {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--_grid-left);
    border-inline-start: 1px solid var(--_border-subtle);
  }

  .grid-line[hidden] {
    display: none;
  }

  .row {
    position: absolute;
    inset-block-start: var(--_row-top);
    inset-inline-start: 0;
    box-sizing: border-box;
    block-size: var(--_row-height, var(--_gantt-row-height));
    inline-size: calc(var(--_gantt-name-width) + var(--_gantt-chart-width));
    border-block-end: 1px solid var(--_border-subtle);
    outline: none;
  }

  .row:focus-visible {
    z-index: var(--_layer-raised);
    box-shadow: inset 0 0 0 2px var(--_focus-ring);
  }

  .row-header {
    display: grid;
    grid-template-columns: var(--_gantt-expander-width) minmax(0, 1fr) auto;
    grid-template-rows: minmax(24px, 1fr) auto;
    align-items: center;
    column-gap: var(--_gantt-tree-gap);
    block-size: 100%;
    padding-inline: calc(var(--_space-sm) + var(--_row-indent)) var(--_space-sm);
    overflow: hidden;
    font-size: var(--_gantt-content-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-content-line);
  }

  :host(:dir(rtl)) .name-header,
  :host(:dir(rtl)) .row-header {
    direction: rtl;
  }

  .expander,
  .row-label {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .expander {
    display: grid;
    grid-column: 1;
    grid-row: 1;
    place-items: center;
    flex: 0 0 var(--_gantt-expander-width);
    block-size: var(--_gantt-expander-width);
    padding: 0;
    border-radius: var(--_radius-sm);
    cursor: pointer;
  }

  .expander:hover {
    background: var(--_surface-hover);
  }

  .expander-placeholder {
    grid-column: 1;
    grid-row: 1;
    inline-size: var(--_gantt-expander-width);
  }

  .row-label {
    grid-column: 2;
    grid-row: 1;
    min-inline-size: 0;
    padding: 0;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .chart {
    block-size: 100%;
    overflow: hidden;
  }

  .item {
    position: absolute;
    display: flex;
    align-items: center;
    inset-block-start: var(--_item-top);
    inset-inline-start: var(--_item-left);
    box-sizing: border-box;
    block-size: var(--_item-height);
    min-block-size: 24px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--_radius-sm);
    background: var(--_gantt-work);
    color: var(--_gantt-work-text);
    font-size: var(--_gantt-content-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-content-line);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .item-label {
    display: block;
    min-inline-size: 0;
    overflow: hidden;
    padding-inline: 4px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item[data-presentation="window"] {
    background: var(--_gantt-window);
    color: var(--_gantt-window-text);
    border-block-start: 1px dashed
      color-mix(in srgb, currentColor 35%, transparent);
  }

  .item-geometry {
    display: none;
  }

  .narrow-interval {
    overflow: visible;
    padding-inline-start: calc(var(--_item-geometry-width) + 4px);
    border: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .item.narrow-interval[data-presentation="window"] {
    border-block-start: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .narrow-interval .item-geometry {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    display: block;
    box-sizing: border-box;
    inline-size: var(--_item-geometry-width);
    border: 1px solid transparent;
    border-radius: var(--_radius-sm);
    background: var(--_gantt-work);
  }

  .narrow-interval .item-label {
    flex: 0 0 auto;
    max-inline-size: 12rem;
    background: var(--_surface-page);
    color: var(--_text-primary);
  }

  .narrow-interval[data-presentation="window"] .item-geometry {
    background: var(--_gantt-window);
    border-block-start: 1px dashed
      color-mix(in srgb, currentColor 35%, transparent);
  }

  .narrow-interval[data-provenance="actual"] .item-geometry {
    border-block-end: 3px solid var(--_gantt-actual);
  }

  .item[data-provenance="actual"] {
    border-block-end: 3px solid var(--_gantt-actual);
  }

  .item.narrow-interval[data-provenance="actual"] {
    border-block-end: 0;
  }

  .item[data-provenance="planned"]::before,
  .item[data-provenance="derived"]::before,
  .item[data-provenance="advisory"]::before {
    content: "≈";
    flex: 0 0 auto;
    padding-inline-start: 3px;
    font-size: 1em;
  }

  .item[data-provenance="planned"]::before {
    content: "○";
  }

  .item[data-provenance="advisory"]::before {
    content: "!";
    font-weight: 700;
  }

  .item[data-provenance="advisory"]:not(.milestone):not(.narrow-interval) {
    border-inline-start: 3px solid var(--_gantt-advisory);
  }

  .narrow-interval[data-provenance="advisory"] {
    border-inline-start: 0;
  }

  .narrow-interval[data-provenance="advisory"] .item-geometry {
    border-inline-start: 3px solid var(--_gantt-advisory);
  }

  .item[aria-pressed="true"] {
    box-shadow: 0 0 0 2px var(--_surface-page),
      0 0 0 4px var(--_gantt-selection);
  }

  .item[data-active="true"] {
    outline: 2px solid var(--_focus-ring);
    outline-offset: 1px;
  }

  .milestone {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .item.milestone::before {
    content: "◆";
    display: block;
    flex: 0 0 12px;
    inline-size: 12px;
    padding: 0;
    margin-inline-end: 4px;
    color: var(--_gantt-work);
    text-align: center;
  }

  .milestone.label-before {
    flex-direction: row-reverse;
  }

  .milestone.label-before::before {
    margin-inline: 4px 0;
  }

  .unscheduled {
    border-style: dotted;
    background: var(--_surface-subtle);
    color: var(--_text-secondary);
  }

  .unscheduled::before {
    content: "Unscheduled · ";
    font-weight: 600;
  }

  .overflow-controls {
    display: flex;
    grid-column: 2;
    grid-row: 2;
    align-items: center;
    justify-self: start;
    gap: 2px;
    margin-block-start: 2px;
  }

  .single-item-overflow {
    grid-column: 3;
    grid-row: 1;
  }

  .overflow-step,
  .item-overflow {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-inline-size: 24px;
    min-block-size: 24px;
    border: 1px solid var(--_border-subtle);
    background: var(--_surface-subtle);
    color: var(--_text-secondary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
  }

  .overflow-step {
    padding: 0;
    border-radius: var(--_radius-md);
    font: inherit;
    cursor: pointer;
  }

  .overflow-step:hover,
  .overflow-step:focus-visible {
    background: var(--_surface-hover);
    outline: 2px solid var(--_focus-ring);
    outline-offset: 1px;
  }

  .item-overflow {
    padding-inline: 4px;
    border-radius: var(--_radius-sm);
  }

  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .clipped-start {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  .clipped-end {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  .status {
    position: sticky;
    inset-inline-start: 0;
    box-sizing: border-box;
    inline-size: min(100%, 34rem);
    margin: var(--_space-md);
    padding: var(--_space-sm) var(--_space-md);
    border: 1px solid var(--_border-subtle);
    border-radius: var(--_radius-md);
    background: var(--_surface-card);
    color: var(--_text-secondary);
    font-size: var(--_body-size);
  }

  .status[data-kind="error"] {
    border-color: var(--_danger-border);
  }

  @container (inline-size < 34rem) {
    .root {
      --_gantt-name-width: var(--violet-gantt-name-column-width-narrow, 10rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .viewport {
      scroll-behavior: auto;
    }
  }

  @media (forced-colors: active) {
    .item[data-presentation="window"],
    .narrow-interval[data-presentation="window"] .item-geometry {
      border-block-start-color: CanvasText;
    }

    .root,
    .header,
    .name-header,
    .row-header,
    .status,
    .item,
    .item-geometry,
    .item-overflow,
    .overflow-step {
      forced-color-adjust: none;
      border-color: CanvasText;
      background: Canvas;
      color: CanvasText;
    }

    .item[aria-pressed="true"],
    .item[data-active="true"],
    .row:focus-visible {
      outline: 2px solid Highlight;
      box-shadow: none;
    }
  }
`;var jg=/^(\d{4})-(\d{2})-(\d{2})$/;function X(t){let e=jg.exec(t);if(!e)return null;let i=Number(e[1]),r=Number(e[2]),o=Number(e[3]),s=new Date(0);return s.setUTCHours(0,0,0,0),s.setUTCFullYear(i,r-1,o),s.getUTCFullYear()!==i||s.getUTCMonth()!==r-1||s.getUTCDate()!==o?null:Math.floor(s.getTime()/864e5)}function At(t){let e=new Date(t*864e5),i=String(e.getUTCFullYear()).padStart(4,"0"),r=String(e.getUTCMonth()+1).padStart(2,"0"),o=String(e.getUTCDate()).padStart(2,"0");return`${i}-${r}-${o}`}function er(t){if(t.kind==="day-point"){let r=X(t.at);return r===null?null:{start:r,endExclusive:r,point:!0}}let e=X(t.start),i=X(t.endExclusive);return e===null||i===null||i<=e?null:{start:e,endExclusive:i,point:!1}}function tr(t,e,i){let r=er(t);return r?r.point?r.start>=e&&r.start<i:r.start<i&&r.endExclusive>e:!1}function au(t,e,i,r){let o=er(t);if(!o||!tr(t,e,i))return null;if(o.point)return{left:(o.start-e+.5)*r,width:0,clippedStart:!1,clippedEnd:!1,point:!0};let s=Math.max(o.start,e),n=Math.min(o.endExclusive,i);return{left:(s-e)*r,width:(n-s)*r,clippedStart:o.start<e,clippedEnd:o.endExclusive>i,point:!1}}var me=Object.freeze({min:"0000-01-01",max:"9999-12-30",endExclusive:"9999-12-31",maxViewportDays:36600}),Wr=52,lu=5,Wo=2,Hg=256,ui=24,qg=12,Wg=6,Ug=192,Rt=864e5,cu={day:40,week:16,month:4},du={compact:36,natural:64,comfortable:76},Kg=0,uu=new Map;function ir(t,e){let i=`${t}|${JSON.stringify(e)}`,r=uu.get(i);return r||(r=new Intl.DateTimeFormat(t,e),uu.set(i,r)),r}function Uo(t,e){return t.composedPath().find(i=>i instanceof HTMLElement&&i.hasAttribute(e))??null}var Gg=u`
  <div
    id="${t=>t.elementId}"
    class="${t=>t.className}"
    part="${t=>t.partName}"
    style="${t=>t.style}"
    role="button"
    tabindex="-1"
    data-item-id="${t=>t.item.id}"
    data-presentation="${t=>t.item.presentation}"
    data-provenance="${t=>t.item.provenance}"
    data-active="${t=>String(t.active)}"
    aria-pressed="${t=>String(t.selected)}"
    aria-label="${t=>t.title}"
  >
    <span class="item-geometry" aria-hidden="true"></span>
    <span class="item-label">${t=>t.item.label}</span>
  </div>
`,Yg=u`
  <div
    class="row"
    part="row"
    style="${t=>t.style}"
    role="row"
    tabindex="${t=>t.tabIndex}"
    data-row-id="${t=>t.row.id}"
    aria-rowindex="${t=>String(t.logicalIndex+2)}"
    aria-level="${t=>String(t.level)}"
    aria-posinset="${t=>String(t.positionInSet)}"
    aria-setsize="${t=>String(t.setSize)}"
    aria-expanded="${t=>t.hasChildren?String(t.expanded):null}"
    aria-activedescendant="${t=>t.activeDescendant}"
  >
    <div
      class="row-header"
      part="row-header"
      role="rowheader"
      style="${t=>t.indentStyle}"
    >
      ${b(t=>t.hasChildren,u`
          <button
            class="expander"
            type="button"
            tabindex="-1"
            data-action="toggle"
            data-row-id="${t=>t.row.id}"
            aria-label="${t=>`${t.expanded?"Collapse":"Expand"} ${t.row.label}`}"
            aria-expanded="${t=>String(t.expanded)}"
          >
            ${t=>t.expanded?"\u25BE":"\u25B8"}
          </button>
        `,u`<span class="expander-placeholder" aria-hidden="true"></span>`)}
      <button
        class="row-label"
        part="row-label"
        type="button"
        tabindex="-1"
        data-action="inspect-row"
        data-row-id="${t=>t.row.id}"
        title="${t=>t.row.description||null}"
      >
        ${t=>t.row.label}
      </button>
      ${b(t=>t.singleItemOverflow,u`
          <button
            class="overflow-step single-item-overflow"
            part="overflow"
            type="button"
            data-action="cycle-overflow"
            data-direction="next"
            data-row-id="${t=>t.row.id}"
            aria-label="${t=>`Reveal item in ${t.row.label}`}"
          >
            ›
          </button>
        `)}
      ${b(t=>t.overflowCount>0&&!t.singleItemOverflow,u`
          <div
            class="overflow-controls"
            role="group"
            aria-label="${t=>`Review ${t.overflowCount} additional item${t.overflowCount===1?"":"s"} in ${t.row.label}`}"
          >
            <button
              class="overflow-step"
              type="button"
              data-action="cycle-overflow"
              data-direction="previous"
              data-row-id="${t=>t.row.id}"
              aria-label="${t=>`Previous item in ${t.row.label}`}"
            >
              ‹
            </button>
            <span class="item-overflow" part="overflow"
              >+${t=>t.overflowCount}</span
            >
            <button
              class="overflow-step"
              type="button"
              data-action="cycle-overflow"
              data-direction="next"
              data-row-id="${t=>t.row.id}"
              aria-label="${t=>`Next item in ${t.row.label}`}"
            >
              ›
            </button>
          </div>
        `)}
    </div>
    <div class="chart" part="chart" role="gridcell">
      ${L(t=>t.items,Gg)}
    </div>
  </div>
`,Xg=u`
  <div
    class="${t=>`day${t.gridBoundary?" grid-boundary":""}`}"
    part="day"
    style="${t=>t.style}"
    aria-hidden="true"
    title="${t=>t.title}"
  >
    <span class="day-label">${t=>t.label}</span>
  </div>
`,Qg=u`
  <span
    class="grid-line"
    style="${t=>t.gridStyle}"
    aria-hidden="true"
    ?hidden="${t=>!t.gridBoundary}"
  ></span>
`,Jg=u`
  <section class="root" part="root">
    <div
      class="toolbar"
      part="toolbar"
      ?hidden="${t=>!t.hasToolbarContent}"
    >
      <slot
        name="toolbar"
        @slotchange="${(t,e)=>t.handleToolbarSlotChange(e.event)}"
      ></slot>
    </div>
    <div
      class="viewport"
      part="viewport"
      tabindex="${t=>t.renderedRows.length===0?"0":null}"
      @scroll="${t=>(t.handleScroll(),!0)}"
      @click="${(t,e)=>(t.handleClick(e.event),!0)}"
      @keydown="${(t,e)=>(t.handleKeydown(e.event),!0)}"
      @focusin="${(t,e)=>(t.handleFocusIn(e.event),!0)}"
    >
      <div
        class="grid"
        part="canvas"
        role="treegrid"
        aria-label="${t=>t.ariaLabel}"
        aria-rowcount="${t=>String(t.logicalRowCount)}"
        aria-colcount="2"
        aria-describedby="${t=>t.instructionsId}"
        style="${t=>t.gridStyle}"
      >
        <p class="sr-only" id="${t=>t.instructionsId}">
          Use Up and Down to move between rows. Use Right and Left to expand or
          collapse groups. Use Alt plus Right or Left to move between items in a
          row, Enter to activate an item, Shift plus Enter to inspect the row,
          and Escape to return to the row.
        </p>
        <div class="header" part="header" role="row" aria-rowindex="1">
          <div class="name-header" part="name-header" role="columnheader">
            Name
          </div>
          <div
            class="time-header"
            part="time-header"
            role="columnheader"
            aria-label="Timeline"
          >
            <span class="sr-only">Timeline</span>
            <span
              class="axis-context"
              part="axis-context"
              style="${t=>t.axisContextStyle}"
            >
              ${t=>t.axisContextLabel}
            </span>
            ${L(t=>t?.renderedDays??[],Xg)}
          </div>
        </div>
        <div class="body" part="body" style="${t=>t.bodyStyle}">
          <div class="body-grid" aria-hidden="true">
            ${L(t=>t?.renderedDays??[],Qg)}
          </div>
          ${L(t=>t?.renderedRows??[],Yg)}
        </div>
      </div>
      ${b(t=>t.shouldShowStatus,u`
          <div
            class="status"
            part="status"
            data-kind="${t=>t.effectiveStatusKind}"
            role="${t=>t.effectiveStatusKind==="error"?"alert":"status"}"
            aria-live="polite"
          >
            ${t=>t.statusText}
          </div>
        `)}
    </div>
  </section>
`,U=class extends f{#e=++Kg;#t=[];#i=[];#r=0;#n=new Map;#s=new Map;#o=new Map;#a=0;#l=null;#c=null;#d=null;#u=null;#h=null;#p=null;#f=null;#m=null;constructor(){super(),this.rows=[],this.items=[],this.expandedRowIds=[],this.selectedItemId=null,this.viewport={start:"2026-01-01",endExclusive:"2026-02-01",scale:"day"},this.status={kind:"ready"},this.today=null,this.presentedRowCount=0,this.renderedRows=[],this.renderedDays=[],this.axisContextLabel="",this.axisContextStyle="",this.validationMessage="",this.viewportError="",this.activeRowId=null,this.activeItemId=null,this.viewportWidth=0,this.viewportHeight=0,this.scrollTop=0,this.scrollLeft=0,this.hasToolbarContent=!1,this.density="natural",this.locale="",this.ariaLabel="Timeline"}connectedCallback(){super.connectedCallback(),this.handleToolbarSlotChange(),this.#O();let e=this.#P;e&&(this.#l=new ResizeObserver(i=>{let r=i[0]?.contentRect;r&&(this.viewportWidth=r.width,this.viewportHeight=r.height,this.#f=null,this.#S(),this.#x())}),this.#l.observe(e),this.viewportWidth=e.clientWidth,this.viewportHeight=e.clientHeight,this.#S()),this.#$()}disconnectedCallback(){this.#l?.disconnect(),this.#l=null,this.#c!==null&&cancelAnimationFrame(this.#c),this.#d!==null&&cancelAnimationFrame(this.#d),this.#c=null,this.#d=null,super.disconnectedCallback()}rowsChanged(){this.#O()}itemsChanged(){this.#O()}expandedRowIdsChanged(){this.#O()}selectedItemIdChanged(){this.#x()}viewportChanged(){this.viewportError=this.#G().error;let e=this.#p;e&&!this.#y(this.viewport,e.source)&&(this.#p=null),this.#S(),!this.#k(!0)&&this.#x()}statusChanged(){this.#x()}localeChanged(){this.#x()}densityChanged(){this.#S(),this.#x()}get instructionsId(){return`violet-gantt-instructions-${this.#e}`}get rowHeight(){return du[this.density]??du.natural}get dayWidth(){return cu[this.viewport?.scale]??cu.day}get logicalRowCount(){return this.presentedRowCount+1}get chartWidth(){let e=this.#M;return Math.max(0,(e?.count??0)*this.dayWidth)}get gridStyle(){return`--_gantt-chart-width:${this.chartWidth}px;--_gantt-day-width:${this.dayWidth}px;`}get bodyStyle(){return this.renderedRows,`--_gantt-body-height:${this.#r}px;`}get effectiveStatusKind(){return this.viewportError?"error":this.#q}get statusText(){if(this.viewportError)return this.viewportError;let e=this.#q;return e!=="ready"?this.#K?(typeof this.status.message=="string"?this.status.message:"")||{loading:"Loading timeline\u2026",empty:"No timeline items.",error:"Timeline unavailable."}[e]:"Invalid timeline status.":this.validationMessage}get shouldShowStatus(){return!!(this.viewportError||this.#q!=="ready"||this.validationMessage)}handleScroll(){let e=this.#P;e&&(this.scrollTop=e.scrollTop,this.scrollLeft=e.scrollLeft,this.#x())}handleToolbarSlotChange(e){let i=e?.currentTarget instanceof HTMLSlotElement?e.currentTarget:this.shadowRoot?.querySelector('slot[name="toolbar"]');this.hasToolbarContent=(i?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0)}handleFocusIn(e){let i=Uo(e,"data-row-id");i?.dataset.rowId&&(this.activeRowId=i.dataset.rowId,e.composedPath()[0]instanceof HTMLButtonElement||this.#x())}handleClick(e){let i=Uo(e,"data-action"),r=i?.dataset.rowId;if(i?.dataset.action==="toggle"&&r){this.#w(r);return}if(i?.dataset.action==="inspect-row"&&r){this.activeRowId=r,this.activeItemId=null,this.$emit("row-inspect",{rowId:r});return}if(i?.dataset.action==="cycle-overflow"&&r){this.activeRowId=r,this.#F(r,i.dataset.direction==="previous"?-1:1),i.classList.contains("single-item-overflow")&&this.#T(r);return}let s=Uo(e,"data-item-id")?.dataset.itemId;if(!s)return;let n=this.renderedRows.find(l=>l.items.some(d=>d.item.id===s));this.activeRowId=n?.row.id??this.activeRowId,this.activeItemId=s;let a=n?this.#s.get(n.row.id)?.find(l=>l.id===s):void 0;a&&this.#E(a),this.$emit("item-selection-change",{itemId:s}),this.$emit("item-activate",{itemId:s}),this.#x()}handleKeydown(e){if(e.composedPath().some(d=>d instanceof HTMLButtonElement))return;let r=Uo(e,"data-row-id")?.dataset.rowId??this.activeRowId,o=r?this.#t.findIndex(d=>d.row.id===r):-1;if(o<0)return;let s=this.#t[o];if(e.altKey&&(e.key==="ArrowRight"||e.key==="ArrowLeft")){this.#F(s.row.id,e.key==="ArrowRight"?1:-1)&&e.preventDefault();return}let n=Math.max(this.rowHeight,this.viewportHeight-Wr),a=getComputedStyle(this).direction==="rtl";switch(e.key==="ArrowRight"||e.key==="ArrowLeft"?e.key==="ArrowRight"!==a?"Expand":"Collapse":e.key){case"ArrowDown":e.preventDefault(),this.#C(Math.min(this.#t.length-1,o+1));break;case"ArrowUp":e.preventDefault(),this.#C(Math.max(0,o-1));break;case"Home":e.preventDefault(),this.#C(0);break;case"End":e.preventDefault(),this.#C(this.#t.length-1);break;case"PageDown":e.preventDefault(),this.#C(Math.max(o+1,this.#_((this.#i[o]?.top??0)+n)));break;case"PageUp":e.preventDefault(),this.#C(Math.min(o-1,this.#_((this.#i[o]?.top??0)-n)));break;case"Expand":e.preventDefault(),s.hasChildren&&!s.expanded?this.#w(s.row.id):s.hasChildren&&s.expanded&&this.#C(o+1);break;case"Collapse":e.preventDefault(),s.hasChildren&&s.expanded?this.#w(s.row.id):s.parentId&&this.#C(this.#t.findIndex(d=>d.row.id===s.parentId));break;case"Enter":{if(e.preventDefault(),e.shiftKey){this.$emit("row-inspect",{rowId:s.row.id});break}let d=this.#D(s),h=d.find(p=>p.id===this.activeItemId)??d[0];h?(this.activeItemId=h.id,this.$emit("item-selection-change",{itemId:h.id}),this.$emit("item-activate",{itemId:h.id})):this.$emit("row-inspect",{rowId:s.row.id}),this.#x();break}case"Escape":e.preventDefault(),this.activeItemId=null,this.#x(),this.#T(s.row.id);break}}focusItem(e){let i=this.#t.findIndex(n=>this.#s.get(n.row.id)?.some(a=>a.id===e));if(i<0)return!1;let r=this.#t[i];if(!r)return!1;let o=this.#s.get(r.row.id)?.find(n=>n.id===e),s=this.#M;return!o||!s||o.time&&!tr(o.time,s.start,s.endExclusive)?!1:(this.activeItemId=e,this.#C(i,!0),this.#E(o),!0)}scrollToDate(e){let i=X(e),r=this.#M;if(i===null||!r||!this.#W(i))return!1;if(i<r.start||i>=r.endExclusive){let s=this.#R(i,r.count);return s?(this.#h=i,this.#v({...s,scale:this.viewport.scale},"programmatic"),this.#k(),!0):!1}let o=this.#P;return o&&(o.scrollLeft=Math.max(0,(i-r.start)*this.dayWidth-this.#H)),!0}panBy(e){let i=this.#M;if(!i||!Number.isSafeInteger(e))return!1;let r=At(i.start+e),o=At(i.endExclusive+e);return this.#U(r,o)?(this.#v({start:r,endExclusive:o,scale:this.viewport.scale},"pan"),!0):!1}showToday(){if(typeof this.today!="string"||!this.today)return!1;let e=X(this.today),i=this.#M;if(e===null||!i||!this.#W(e))return!1;let r=this.#R(e,i.count);return r?(this.#h=e,this.#v({...r,scale:this.viewport.scale},"today"),this.#k(),!0):!1}fitItems(){let e=Number.POSITIVE_INFINITY,i=Number.NEGATIVE_INFINITY;for(let a of this.#s.values())for(let l of a){if(!l.time)continue;let d=er(l.time);d&&(e=Math.min(e,d.start),i=Math.max(i,d.point?d.start+1:d.endExclusive))}if(!Number.isFinite(e)||!Number.isFinite(i))return!1;let r=Math.max(X(me.min)??e,e-1),o=Math.min(X(me.endExclusive)??i,i+1),s=At(r),n=At(o);return this.#U(s,n)?(this.#v({start:s,endExclusive:n,scale:this.viewport.scale},"fit"),!0):!1}#v(e,i){this.$emit("viewport-change",{viewport:e,reason:i})}#b(e){if(this.#q==="loading"||this.#q==="error")return;let i=this.#P;if(!i)return;let r=i.clientWidth-this.#H;if(r<=0)return;let o=Math.ceil(r/this.dayWidth);if(o<=e.count)return;let s=this.#p;if(s&&this.#y(this.viewport,s.source)&&s.requestedDays>=o)return;let n=X(me.endExclusive);if(n===null)return;let a=Math.min(e.start+me.maxViewportDays,e.start+o,n);if(a<=e.endExclusive)return;let l=At(a);this.#U(this.viewport.start,l)&&(this.#p={source:{...this.viewport},requestedDays:o},this.#v({...this.viewport,endExclusive:l},"resize"))}#y(e,i){return e?.start===i?.start&&e?.endExclusive===i?.endExclusive&&e?.scale===i?.scale}#k(e=!1){let i=this.#h;if(i===null)return!1;let r=this.#M;if(!r||i<r.start||i>=r.endExclusive)return e&&r&&(this.#h=null),!1;let o=this.#P;if(!o)return!1;let s=Math.max(this.dayWidth,this.viewportWidth-this.#H),n=(i-r.start)*this.dayWidth;return o.scrollLeft=Math.max(0,n-s/2+this.dayWidth/2),this.scrollLeft=o.scrollLeft,this.#h=null,this.#$(),!0}#R(e,i){let r=X(me.min),o=X(me.endExclusive);if(r===null||o===null||i<=0||i>o-r||e<r||e>=o)return null;let s=e-Math.floor(i/2),n=Math.max(r,Math.min(s,o-i));return{start:At(n),endExclusive:At(n+i)}}#w(e){let i=new Set(Array.isArray(this.expandedRowIds)?this.expandedRowIds.filter(r=>typeof r=="string"):[]);i.has(e)?i.delete(e):i.add(e),this.$emit("expanded-change",{expandedRowIds:[...i]})}#F(e,i){let r=this.#t.find(l=>l.row.id===e);if(!r)return!1;let o=this.#D(r);if(o.length===0)return!1;let s=o.findIndex(l=>l.id===this.activeItemId),n=s<0?i>0?0:o.length-1:(s+i+o.length)%o.length,a=o[n];return this.activeItemId=a?.id??null,a&&this.#E(a),!0}#S(){let e=this.#M,i=this.rowHeight,r=0;this.#i=this.#t.map(o=>{let s=(this.#s.get(o.row.id)??[]).filter(d=>!d.time||e&&tr(d.time,e.start,e.endExclusive)),n=Math.min(Wg,Math.max(1,s.length)),a=Math.max(i,n*ui+qg),l={top:r,height:a,laneCapacity:n};return r+=a,l}),this.#r=r,this.#B()}#_(e){if(this.#i.length===0)return-1;let i=Math.max(0,Math.min(e,Math.max(0,this.#r-1))),r=0,o=this.#i.length;for(;r<o;){let s=Math.floor((r+o)/2),n=this.#i[s];n&&n.top+n.height<=i?r=s+1:o=s}return Math.min(r,this.#i.length-1)}#B(){let e=this.#P,i=e?.clientHeight??this.viewportHeight;if(!Number.isFinite(i)||i<=0)return;let r=Math.max(0,Wr+this.#r-i),o=Math.max(0,Math.min(e?.scrollTop??this.scrollTop,r));e&&e.scrollTop!==o&&(e.scrollTop=o),this.scrollTop=o}#C(e,i=!1){let r=this.#t[e],o=this.#i[e];if(!r||!o)return;this.activeRowId=r.row.id,this.#u=r.row.id,i||(this.activeItemId=null);let s=this.#P;if(s){let n=s.scrollTop,a=s.scrollTop+Math.max(0,s.clientHeight-Wr);o.top<n?s.scrollTop=o.top:o.top+o.height>a&&(s.scrollTop=o.top+o.height-(s.clientHeight-Wr)),this.scrollTop=s.scrollTop}this.#$(),this.#T(r.row.id)}#T(e){this.#u=e,this.#d!==null&&cancelAnimationFrame(this.#d),this.#d=requestAnimationFrame(()=>{this.#d=null;let r=[...this.shadowRoot?.querySelectorAll(".row[data-row-id]")??[]].find(o=>o.dataset.rowId===e);r&&(r.focus(),this.#u=null)})}#x(){this.#f=null,!(!this.$fastController.isConnected||this.#c!==null)&&(this.#c=requestAnimationFrame(()=>{this.#c=null,this.#$()}))}#$(){this.#f=null;let e=this.#M;if(!e){this.renderedRows=[],this.renderedDays=[],this.axisContextLabel="",this.axisContextStyle="";return}let i=Math.max(this.rowHeight,this.viewportHeight-Wr),r=this.#z,o=this.#u??r,s=this.#_(this.scrollTop),n=this.#_(this.scrollTop+i),a=Math.max(0,s-lu),l=Math.min(this.#t.length,n+1+lu),d=new Set(Array.from({length:Math.max(0,l-a)},(D,_)=>a+_)),h=o?this.#t.findIndex(D=>D.row.id===o):-1;h>=0&&d.add(h),this.renderedRows=[...d].sort((D,_)=>D-_).flatMap(D=>{let _=this.#t[D];return _?[this.#I(_)]:[]}),this.#u&&this.#T(this.#u);let p=Math.max(this.dayWidth,this.viewportWidth-this.#H),x=Math.max(0,Math.floor(this.scrollLeft/this.dayWidth)-Wo),k=Math.min(e.count,Math.ceil((this.scrollLeft+p)/this.dayWidth)+Wo),S=Math.min(e.endExclusive-1,e.start+Math.max(0,Math.floor(this.scrollLeft/this.dayWidth))),A=Math.min(e.endExclusive-1,e.start+Math.ceil((this.scrollLeft+p)/this.dayWidth)-1);if(this.axisContextLabel=this.#X(S),this.viewport.scale==="month"){let D=this.#X(A);D!==this.axisContextLabel&&(this.axisContextLabel+=` \u2013 ${D}`)}this.axisContextStyle=`--_axis-context-left:${this.scrollLeft+8}px;`,this.renderedDays=Array.from({length:Math.max(0,k-x)},(D,_)=>{let T=x+_,I=e.start+T,M=At(I),V=Math.min(this.#Y(I),e.endExclusive-I),O=this.#te(I);return{date:M,label:this.#ee(I,S),title:this.#ie(I),style:`--_day-left:${T*this.dayWidth}px;--_day-width:${this.dayWidth}px;--_day-label-width:${V*this.dayWidth}px;`,gridStyle:`--_grid-left:${T*this.dayWidth}px;`,gridBoundary:O}}),this.#b(e)}#I(e){let i=this.#i[e.logicalIndex]??{top:e.logicalIndex*this.rowHeight,height:this.rowHeight,laneCapacity:1},r=this.#L(e),o=r.items,s=o.find(n=>n.item.id===this.activeItemId);return{...e,style:`--_row-top:${i.top}px;--_row-height:${i.height}px;`,indentStyle:`--_row-indent:${Math.max(0,e.level-1)*16}px;`,items:o,tabIndex:this.activeRowId===e.row.id||!this.activeRowId&&e.logicalIndex===0?"0":"-1",activeDescendant:s?.elementId??null,overflowCount:r.overflowCount,singleItemOverflow:r.singleItemOverflow}}#L(e){let i=this.#M;if(!i)return{items:[],overflowCount:0,singleItemOverflow:!1};let r=this.#V(i),s=(this.#s.get(e.row.id)??[]).flatMap(_=>{if(!_.time)return this.scrollLeft<=220?[{item:_,left:8,width:Math.min(180,Math.max(80,_.label.length*7+92)),point:!1,clippedStart:!1,clippedEnd:!1,unscheduled:!0}]:[];if(!r||!tr(_.time,r.start,r.endExclusive))return[];let T=au(_.time,i.start,i.endExclusive,this.dayWidth);return T?[{item:_,...T,unscheduled:!1}]:[]}),n=this.#i[e.logicalIndex],a=n?.height??this.rowHeight,l=n?.laneCapacity??1,d=s.slice(0,l),h=s.findIndex(_=>_.item.id===this.activeItemId&&e.row.id===this.activeRowId),p=s[h];h>=l&&l>0&&p&&(d=[...d.slice(0,-1),p]);let x=Math.max(2,(a-d.length*ui)/2),k=d.map((_,T)=>{let I=_.item,M=I.id===this.selectedItemId,V=I.id===this.activeItemId&&e.row.id===this.activeRowId,O=_.point?Math.min(Ug,Math.max(120,I.label.length*7+24)):Math.max(ui,_.width),j=this.chartWidth-(_.left-6),le=_.left+6,ge=_.point&&O>j&&le>j,Ze=_.point?Math.max(ui,Math.min(O,ge?le:j)):O,Ie=_.point?ge?Math.max(0,le-Ze):_.left-6:_.left,De=!_.point&&!_.unscheduled&&_.width<ui,Ot=["item",I.presentation==="milestone"?"milestone":"",ge?"label-before":"",De?"narrow-interval":"",_.unscheduled?"unscheduled":"",_.clippedStart?"clipped-start":"",_.clippedEnd?"clipped-end":""].filter(Boolean).join(" "),et=["item",I.presentation,_.unscheduled?"unscheduled":"",M?"selection":""].filter(Boolean).join(" ");return{item:I,style:`--_item-left:${Ie}px;--_item-top:${x+T*ui}px;--_item-height:${ui}px;--_item-geometry-width:${Math.max(2,_.width)}px;inline-size:${Ze}px;`,className:Ot,partName:et,selected:M,active:V,title:this.#N(I),elementId:this.#A(I.id)}}),S=new Set(k.map(_=>_.item.id)),A=this.#D(e),D=A.reduce((_,T)=>_+(S.has(T.id)?0:1),0);return{items:k,overflowCount:D,singleItemOverflow:D===1&&A.length===1}}#D(e){let i=this.#M;return i?(this.#s.get(e.row.id)??[]).filter(r=>!r.time||tr(r.time,i.start,i.endExclusive)):[]}#E(e){let i=this.#P,r=this.#M;if(!(!i||!r)){if(!e.time)i.scrollLeft=0;else{let o=er(e.time);if(o){let s=(o.start-r.start)*this.dayWidth,n=Math.max(this.dayWidth,this.viewportWidth-this.#H);(s<this.scrollLeft||s>this.scrollLeft+n-this.dayWidth)&&(i.scrollLeft=Math.max(0,s-n/2))}}this.scrollLeft=i.scrollLeft,this.#$()}}#A(e){let i=this.#o.get(e);if(i)return i;let r=`violet-gantt-${this.#e}-item-${++this.#a}`;return this.#o.set(e,r),r}#N(e){let i=this.#g(e.time),r=e.readOnlyReason?`. Read only: ${e.readOnlyReason}`:". Read only.";return`${e.label}. ${e.presentation}. ${i}. ${e.provenance}${r}${e.note?` ${e.note}`:""}`}#g(e){if(!e)return"Unscheduled";let i=ir(this.resolvedLocale,{dateStyle:"medium",timeZone:"UTC"});if(e.kind==="day-point"){let l=X(e.at);return l===null?e.at:i.format(new Date(l*Rt))}let r=X(e.start),o=X(e.endExclusive);if(r===null||o===null||o<=r)return`${e.start} to ${e.endExclusive}`;let s=o-r,n=new Date(r*Rt);return`${s===1?i.format(n):i.formatRange(n,new Date((o-1)*Rt))} (${s} ${s===1?"day":"days"})`}#V(e){let i=Math.max(this.dayWidth,this.viewportWidth-this.#H),r=Math.max(0,Math.floor(this.scrollLeft/this.dayWidth)-Wo),o=Math.min(e.count,Math.ceil((this.scrollLeft+i)/this.dayWidth)+Wo);return{start:e.start+r,endExclusive:e.start+Math.max(r+1,o)}}get#z(){return this.shadowRoot?.activeElement?.closest(".row[data-row-id]")?.dataset.rowId??null}get#j(){let e=this.shadowRoot?.activeElement;return e===this.#P||!!e?.closest(".row[data-row-id]")}#O(){let e=this.#n,i=this.activeRowId,r=this.#j,o=[],s=new Map;for(let _ of Array.isArray(this.rows)?this.rows:[]){if(!this.#Q(_)||s.has(_.id)){o.push("duplicate, empty, or non-text row data");continue}s.set(_.id,_)}let n=new Map;for(let _ of s.keys()){if(n.has(_))continue;let T=[],I=new Set,M=_,V="valid";for(;M;){let O=n.get(M);if(O){V=O;break}if(I.has(M)){V="invalid";break}let j=s.get(M);if(!j){V="invalid";break}I.add(M),T.push(M),M=j.parentId??null}for(let O of T)n.set(O,V);V==="invalid"&&o.push("orphan or cyclic row identity")}let a=new Map([...s].filter(([_])=>n.get(_)==="valid")),l=new Map;for(let _ of a.values()){let T=_.parentId??null,I=l.get(T)??[];I.push(_),l.set(T,I)}let d=new Set(Array.isArray(this.expandedRowIds)?this.expandedRowIds.filter(_=>typeof _=="string"):[]),h=[],p=l.get(null)??[],x=p.map((_,T)=>({row:_,level:1,positionInSet:T+1,setSize:p.length})).reverse();for(;x.length>0;){let _=x.pop();if(!_)break;let{row:T,level:I,positionInSet:M,setSize:V}=_,O=l.get(T.id)??[],j=d.has(T.id);if(h.push({row:T,logicalIndex:h.length,level:I,positionInSet:M,setSize:V,parentId:T.parentId??null,hasChildren:O.length>0,expanded:j}),j)for(let le=O.length-1;le>=0;le-=1){let ge=O[le];ge&&x.push({row:ge,level:I+1,positionInSet:le+1,setSize:O.length})}}let k=new Map;for(let _ of Array.isArray(this.items)?this.items:[]){if(!this.#J(_)||k.has(_.id)){o.push("duplicate, empty, or non-text item data");continue}k.set(_.id,_)}let S=new Map,A=new Set;for(let _ of a.values()){let T=[],I=new Set;for(let M of _.itemIds??[]){if(I.has(M)){o.push("duplicate row item identity");continue}I.add(M);let V=k.get(M);if(!V||V.rowId!==_.id){o.push("orphan or mismatched item identity");continue}if(!this.#Z(V)){o.push("invalid item date or presentation");continue}A.add(V.id),T.push(V)}S.set(_.id,T)}A.size!==k.size&&o.push("unreferenced item identity");for(let _ of this.#o.keys())A.has(_)||this.#o.delete(_);if(this.#n=a,this.#s=S,this.#t=h,this.presentedRowCount=h.length,this.#S(),this.validationMessage=o.length?`${o.length} invalid timeline record${o.length===1?" was":"s were"} omitted.`:"",i&&!h.some(_=>_.row.id===i)){let _=e.get(i)?.parentId??null;for(;_&&!h.some(T=>T.row.id===_);)_=e.get(_)?.parentId??null;this.activeRowId=_??h[0]?.row.id??null}else this.activeRowId||(this.activeRowId=h[0]?.row.id??null);h.length||(this.activeRowId=null),(this.activeRowId?S.get(this.activeRowId)??[]:[]).some(_=>_.id===this.activeItemId)||(this.activeItemId=null),this.#u&&!h.some(_=>_.row.id===this.#u)&&(this.#u=null),r&&this.$fastController.isConnected&&this.activeRowId&&this.#T(this.activeRowId),this.$fastController.isConnected?this.#$():this.#x()}#Q(e){return!!(e&&typeof e.id=="string"&&e.id.length>0&&typeof e.label=="string"&&(e.parentId===void 0||typeof e.parentId=="string")&&(e.description===void 0||typeof e.description=="string")&&Array.isArray(e.itemIds)&&e.itemIds.every(i=>typeof i=="string"))}#J(e){return!!(e&&typeof e.id=="string"&&e.id.length>0&&typeof e.rowId=="string"&&e.rowId.length>0&&typeof e.label=="string"&&(e.note===void 0||typeof e.note=="string")&&(e.readOnlyReason===void 0||typeof e.readOnlyReason=="string")&&["work","window","milestone"].includes(e.presentation)&&["planned","derived","actual","advisory"].includes(e.provenance))}#Z(e){if(!e.time)return!0;if(typeof e.time!="object"||e.time.kind==="day-point"&&typeof e.time.at!="string"||e.time.kind==="day-range"&&(typeof e.time.start!="string"||typeof e.time.endExclusive!="string")||e.time.kind!=="day-point"&&e.time.kind!=="day-range")return!1;let i=er(e.time);return!i||!this.#W(i.start)||!i.point&&!this.#W(i.endExclusive-1)?!1:e.presentation==="milestone"?i.point:!i.point}get#K(){return!!(this.status&&typeof this.status=="object"&&["ready","loading","empty","error"].includes(this.status.kind)&&(this.status.message===void 0||typeof this.status.message=="string"))}get#q(){return this.#K?this.status.kind:"error"}get#M(){return this.#G().days}#G(){let e=this.viewport,i=this.#m;if(i&&i.start===e?.start&&i.endExclusive===e?.endExclusive&&i.scale===e?.scale)return i;let r=X(e?.start??""),o=X(e?.endExclusive??""),s=X(me.min)??0,n=X(me.endExclusive)??0,a=r===null||o===null?0:o-r,l=e&&["day","week","month"].includes(e.scale),d=r===null||o===null||a<=0||a>me.maxViewportDays||r<s||o>n||!l,h={start:e?.start,endExclusive:e?.endExclusive,scale:e?.scale,days:d?null:{start:r,endExclusive:o,count:a},error:d?`Viewport must be a half-open YYYY-MM-DD range within ${me.min}\u2013${me.endExclusive}, spanning at most ${me.maxViewportDays.toLocaleString()} days.`:""};return this.#m=h,h}#W(e){let i=X(me.min)??0,r=X(me.max)??0;return e>=i&&e<=r}#U(e,i){let r=X(e),o=X(i);return r!==null&&o!==null&&this.#W(r)&&o>r&&o<=(X(me.endExclusive)??o)&&o-r<=me.maxViewportDays}#ee(e,i){let r=new Date(e*Rt);return this.viewport.scale==="month"?e>=i&&(r.getUTCDate()===1||e===i&&this.#Y(e)*this.dayWidth>=24)?ir(this.resolvedLocale,{month:"short",timeZone:"UTC"}).format(r):"":this.viewport.scale==="week"?r.getUTCDay()===1?ir(this.resolvedLocale,{month:"short",day:"numeric",timeZone:"UTC"}).format(r):"":ir(this.resolvedLocale,{day:"numeric",timeZone:"UTC"}).format(r)}#Y(e){if(this.viewport.scale==="week")return 7;if(this.viewport.scale!=="month")return 1;let i=new Date(e*Rt),r=new Date(i.getTime());return r.setUTCFullYear(i.getUTCFullYear(),i.getUTCMonth()+1,1),Math.max(1,Math.round((r.getTime()-i.getTime())/Rt))}#te(e){if(this.viewport.scale==="day")return!0;let i=new Date(e*Rt);return this.viewport.scale==="week"?i.getUTCDay()===1:i.getUTCDate()===1}#ie(e){return ir(this.resolvedLocale,{dateStyle:"full",timeZone:"UTC"}).format(new Date(e*Rt))}#X(e){return ir(this.resolvedLocale,{...this.viewport.scale==="month"?{}:{month:"long"},year:"numeric",timeZone:"UTC"}).format(new Date(e*Rt))}get#H(){if(this.#f===null){let i=this.shadowRoot?.querySelector(".name-header")?.getBoundingClientRect().width??0;this.#f=i>0?i:Hg}return this.#f}get resolvedLocale(){return this.locale||document.documentElement.lang||navigator.language||"en-US"}get#P(){return this.shadowRoot?.querySelector(".viewport")}};c(U.prototype,"density");c(U.prototype,"locale");c({attribute:"aria-label",mode:"fromView"})(U.prototype,"ariaLabel");m(U.prototype,"rows");m(U.prototype,"items");m(U.prototype,"expandedRowIds");m(U.prototype,"selectedItemId");m(U.prototype,"viewport");m(U.prototype,"status");m(U.prototype,"today");m(U.prototype,"presentedRowCount");m(U.prototype,"renderedRows");m(U.prototype,"renderedDays");m(U.prototype,"axisContextLabel");m(U.prototype,"axisContextStyle");m(U.prototype,"validationMessage");m(U.prototype,"viewportError");m(U.prototype,"activeRowId");m(U.prototype,"activeItemId");m(U.prototype,"viewportWidth");m(U.prototype,"viewportHeight");m(U.prototype,"scrollTop");m(U.prototype,"scrollLeft");m(U.prototype,"hasToolbarContent");customElements.get("violet-gantt")||await f.define(U,{name:"violet-gantt",template:Jg,styles:nu});var Zg=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},hu=0,ev=v`
    ${Ce}

    :host {
        display: inline-flex;
        vertical-align: middle;
        --_panel-min-inline: var(--violet-menu-min-inline-size, 180px);
        --_panel-max-inline: var(--violet-menu-max-inline-size, 320px);
        --_panel-max-block: var(--violet-menu-max-height, 360px);
        --_panel-padding: var(--violet-menu-padding, var(--_space-sm));
        --_panel-radius: var(--violet-menu-radius, calc(var(--_radius-md) * 2));
        --_panel-gap: var(--violet-menu-gap, var(--_space-sm));
        --_panel-background: var(--violet-menu-background, var(--_surface-card));
        --_panel-shadow: var(--violet-menu-shadow, var(--_shadow-floating));
        --_panel-border-color: var(--violet-menu-border-color, var(--_border-subtle));
    }

    .panel {
        box-sizing: border-box;
        min-inline-size: var(--_panel-min-inline);
        max-inline-size: var(--_panel-max-inline);
        max-block-size: min(var(--_panel-max-block), 80vh);
        overflow-y: auto;
        overscroll-behavior: contain;
        /* Override popover UA defaults (inset:0 margin:auto) */
        inset: unset;
        margin: 0;
        padding: var(--_panel-padding);
        border: thin solid var(--_panel-border-color);
        border-radius: var(--_panel-radius);
        background: var(--_panel-background);
        box-shadow: var(--_panel-shadow);
        color: inherit;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line, 20px);
        z-index: var(--_layer-popover);
    }

    .panel::backdrop {
        background: transparent;
    }

    /* Separator styling for slotted <hr> elements */
    ::slotted(hr) {
        border: none;
        block-size: thin;
        margin-block: var(--_space-sm);
        margin-inline: calc(var(--_space-sm) * 2);
        background: var(--_border-subtle);
    }

    @media (forced-colors: active) {
        .panel {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
        }
    }
`,tv=u`
    <slot
        name="trigger"
        @click="${t=>t.handleTriggerClick()}"
        @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
    ></slot>
    <div
        class="panel"
        part="panel"
        id="${t=>t.panelId}"
        popover="auto"
        role="menu"
        aria-label="${t=>t.label||null}"
        @keydown="${(t,e)=>t.handlePanelKeydown(e.event)}"
        @toggle="${(t,e)=>t.handleToggle(e.event)}"
    >
        <slot @slotchange="${t=>t.handleItemsSlotChange()}"></slot>
    </div>
`,Ur=class extends f{#e;#t=-1;#i="";#r=0;constructor(){super(),this.#e=hu,hu+=1,this.panelId=`violet-menu-panel-${this.#e}`,this.open=!1,this.label=""}connectedCallback(){super.connectedCallback(),this.#l()}disconnectedCallback(){this.#p(),super.disconnectedCallback()}toggle(){this.#n?.togglePopover()}show(){this.#n?.showPopover()}hide(){this.#n?.matches(":popover-open")&&this.#n.hidePopover()}handleTriggerClick(){this.#n?.togglePopover()}handleTriggerKeydown(e){switch(e.key){case"ArrowDown":return e.preventDefault(),this.#c("first"),!1;case"ArrowUp":return e.preventDefault(),this.#c("last"),!1}return!0}handlePanelKeydown(e){let i=this.#o;if(i.length===0)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#d(this.#u(this.#t,1,i)),!1;case"ArrowUp":return e.preventDefault(),this.#d(this.#u(this.#t,-1,i)),!1;case"Home":return e.preventDefault(),this.#d(0),!1;case"End":return e.preventDefault(),this.#d(i.length-1),!1;case"Enter":case" ":{e.preventDefault();let r=i[this.#t];return r&&!r.disabled&&(r.$emit("invoke"),this.hide()),!1}case"Escape":return e.preventDefault(),this.hide(),this.#s?.focus(),!1;case"Tab":return this.hide(),!0;default:{if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){this.#h(e.key,i);break}return!0}}return!1}handleToggle(e){let i=e.newState==="open";this.open=i,i?(this.#a(),requestAnimationFrame(()=>{this.open&&this.#t===-1&&this.#d(0)})):(this.#t=-1,this.#p()),this.#l(),this.$emit("open-change",{open:i})}handleItemsSlotChange(){this.#f()}openChanged(){if(!this.$fastController.isConnected)return;let e=this.#n;if(!e)return;let i=e.matches(":popover-open");this.open&&!i?e.showPopover():!this.open&&i&&e.hidePopover(),this.#l()}get#n(){return this.shadowRoot?.querySelector(".panel")??null}get#s(){return(this.shadowRoot?.querySelector('slot[name="trigger"]')?.assignedElements({flatten:!0})??[])[0]??null}get#o(){return Array.from(this.querySelectorAll("violet-menu-item"))}#a(){let e=this.#n;if(!e)return;let i=(this.#s??this).getBoundingClientRect(),r=Number.parseFloat(getComputedStyle(this).getPropertyValue("--_panel-gap"))||4;e.style.position="fixed",e.style.top=`${i.bottom+r}px`,e.style.left=`${i.left}px`,requestAnimationFrame(()=>{let o=e.getBoundingClientRect();o.bottom>window.innerHeight&&(e.style.top=`${i.top-o.height-r}px`),o.right>window.innerWidth&&(e.style.left=`${i.right-o.width}px`)})}#l(){let e=this.#s;if(!e)return;e.setAttribute("aria-haspopup","menu"),e.setAttribute("aria-expanded",String(this.open));let i=this.shadowRoot;i&&"referenceTarget"in ShadowRoot.prototype?(i.referenceTarget=this.panelId,this.id||(this.id=`${this.panelId}-host`),e.setAttribute("aria-controls",this.id)):e.removeAttribute("aria-controls")}#c(e){let i=this.#n;if(!i)return;let r=this.#o;if(i.matches(":popover-open")){let o=e==="first"?1:-1;this.#d(this.#t===-1?e==="first"?0:r.length-1:this.#u(this.#t,o,r));return}i.showPopover(),this.#d(e==="first"?0:r.length-1)}#d(e){let i=this.#o;e<0||e>=i.length||(this.#t=e,i[e]?.focus())}#u(e,i,r){let o=r.length;if(o===0)return-1;let s=e+i;return s<0?s=o-1:s>=o&&(s=0),s}#h(e,i){this.#r&&clearTimeout(this.#r),this.#i+=e.toLowerCase(),this.#r=window.setTimeout(()=>{this.#p()},500);let r=this.#t+1;for(let o=0;o<i.length;o++){let s=(r+o)%i.length,n=i[s];if(n&&n.labelText.toLowerCase().startsWith(this.#i)){this.#d(s);return}}}#p(){this.#i="",this.#r&&(clearTimeout(this.#r),this.#r=0)}#f(){for(let e of this.#o)e.removeEventListener("invoke",this.#m),e.addEventListener("invoke",this.#m)}#m=()=>{let e=this.getRootNode(),i=this.contains(e.activeElement)||this.matches(":focus-within");this.hide(),i&&this.#s?.focus()}};Zg([m],Ur.prototype,"open",void 0);c(Ur.prototype,"label");customElements.get("violet-menu")||await f.define(Ur,{name:"violet-menu",template:tv,styles:ev});var iv=v`
    ${Ce}

    :host {
        display: flex;
        --_surface-hover: var(--color-surface-subtle, #f0efe6);
        --_surface-highlight: var(--color-surface-highlight, #ffffff);
        --_surface-pressed: var(--color-surface-pressed, #e7e4d8);
    }

    .control {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: calc(var(--_space-inline-sm) * 2);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: calc(var(--_space-inline-md, 8px) * 1.5);
        padding-block: 0;
        border: none;
        border-radius: var(--_radius-md);
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-type-size);
        line-height: var(--_type-body-line, 20px);
        text-align: start;
        white-space: nowrap;
        transition: background-color var(--_duration-fast) var(--_easing-standard);
    }

    .control:hover:not([aria-disabled="true"]) {
        background: var(--_surface-hover);
    }

    .control:active:not([aria-disabled="true"]) {
        background: var(--_surface-pressed);
    }

    .control:focus-visible {
        background: var(--_surface-highlight);
        outline: 2px solid var(--_focus-ring);
        outline-offset: -2px;
    }

    .control[aria-disabled="true"] {
        color: var(--_text-secondary);
        cursor: not-allowed;
        opacity: 0.55;
    }

    .control[aria-disabled="true"]:hover {
        background: transparent;
    }

    slot[name="before"],
    slot[name="after"] {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
    }

    .label {
        flex: 1 1 auto;
        min-inline-size: 0;
    }

    @media (forced-colors: active) {
        .control:hover:not([aria-disabled="true"]) {
            forced-color-adjust: none;
            background: Highlight;
            color: HighlightText;
        }

        .control:focus-visible {
            outline-color: Highlight;
        }

        .control[aria-disabled="true"] {
            color: GrayText;
        }
    }
`,rv=u`
    <div
        class="control"
        part="control"
        role="menuitem"
        tabindex="-1"
        aria-disabled="${t=>t.disabled?"true":"false"}"
        @click="${(t,e)=>t.handleClick(e.event)}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </div>
`,Ko=class extends f{constructor(){super(),this.disabled=!1}handleClick(e){if(this.disabled){e.preventDefault(),e.stopPropagation();return}this.$emit("invoke")}get labelText(){return this.textContent?.trim()??""}};c({mode:"boolean"})(Ko.prototype,"disabled");customElements.get("violet-menu-item")||await f.define(Ko,{name:"violet-menu-item",template:rv,styles:iv,shadowOptions:{delegatesFocus:!0}});var Yo={fromView(t){let e=Number.parseInt(t,10);return Number.isFinite(e)?e:0},toView(t){return String(t)}},ov=v`
    ${Ce}

    :host {
        display: inline-flex;
        max-inline-size: 100%;
    }

    .nav {
        display: inline-flex;
        max-inline-size: 100%;
    }

    .list {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--_space-xs);
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .item {
        display: inline-flex;
        align-items: center;
    }

    .button,
    .ellipsis {
        box-sizing: border-box;
        min-inline-size: calc(var(--_target-size) - var(--_space-xs));
        min-block-size: calc(var(--_target-size) - var(--_space-xs));
        border-radius: var(--_radius-md);
        font-family: inherit;
        font-size: var(--_control-body-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-body-line);
    }

    .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--_space-md);
        border: 1px solid transparent;
        background: transparent;
        color: var(--_text-secondary);
        cursor: pointer;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard);
    }

    .button:hover {
        background: var(--_action-secondary-background);
        color: var(--_text-primary);
    }

    .button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .button[aria-current="page"] {
        background: var(--_surface-page);
        border-color: var(--_border-subtle);
        box-shadow: var(--_shadow-control);
        color: var(--_text-primary);
    }

    .button[data-kind="nav"] {
        padding-inline: var(--_space-lg);
    }

    .button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
    }

    .ellipsis {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 var(--_space-sm);
        color: var(--_text-muted);
    }

    :host([disabled]) {
        opacity: 0.72;
    }

    @media (forced-colors: active) {
        .button,
        .ellipsis {
            forced-color-adjust: none;
        }

        .button {
            border-color: ButtonText;
            color: ButtonText;
            background: Canvas;
            box-shadow: none;
        }

        .button[aria-current="page"] {
            background: Highlight;
            border-color: Highlight;
            color: HighlightText;
        }

        .ellipsis {
            color: ButtonText;
        }
    }
`,sv=u`
    <nav class="nav" part="nav" aria-label="${t=>t.label}">
        <ol class="list" part="list"></ol>
    </nav>
`,Ft=class extends f{#e;constructor(){super(),this.#e=!1,this.label="Pagination",this.disabled=!1,this.page=1,this.pageCount=1,this.siblingCount=1,this.boundaryCount=1}connectedCallback(){super.connectedCallback(),this.#e=!0,this.page=Go(this,"page",this.page||1),this.pageCount=Go(this,"page-count",this.pageCount||1),this.siblingCount=Go(this,"sibling-count",this.siblingCount||0),this.boundaryCount=Go(this,"boundary-count",this.boundaryCount||0),this.#e=!1,this.#t(),this.#i()}pageChanged(){!this.isConnected||this.#e||(this.#t(),this.#i())}pageCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#i())}siblingCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#i())}boundaryCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#i())}goPrevious(){this.goToPage(this.page-1)}goNext(){this.goToPage(this.page+1)}goToPage(e){if(this.disabled)return;let i=pu(e,1,this.pageCount);i!==this.page&&(this.page=i,this.#i(),this.$emit("page-change",{page:this.page}),this.$emit("change"))}#t(){this.pageCount=Math.max(1,this.pageCount||1),this.siblingCount=Math.max(0,this.siblingCount||0),this.boundaryCount=Math.max(0,this.boundaryCount||0),this.page=pu(this.page||1,1,this.pageCount)}#i(){let e=this.listElement;if(!e)return;let i=document.createDocumentFragment();i.append(this.#n("Previous","previous-button","Previous page",this.page<=1,()=>{this.goPrevious()}));for(let r of this.#r()){if(r.kind==="ellipsis"){i.append(this.#o());continue}i.append(this.#s(r.page,r.current))}i.append(this.#n("Next","next-button","Next page",this.page>=this.pageCount,()=>{this.goNext()})),e.replaceChildren(i)}#r(){return nv(this.page,this.pageCount,this.siblingCount,this.boundaryCount).map((i,r)=>i==="ellipsis"?{kind:"ellipsis",key:`ellipsis-${r}`}:{kind:"page",key:`page-${i}`,page:i,current:i===this.page})}#n(e,i,r,o,s){let n=document.createElement("li");n.className="item",n.setAttribute("part",i==="previous-button"?"item previous":"item next");let a=document.createElement("button");return a.className="button",a.type="button",a.dataset.kind="nav",a.setAttribute("part",`button ${i}`),a.setAttribute("aria-label",r),a.disabled=this.disabled||o,a.textContent=e,a.addEventListener("click",s),n.append(a),n}#s(e,i){let r=document.createElement("li");r.className="item",r.setAttribute("part","item page-item");let o=document.createElement("button");return o.className="button",o.type="button",o.setAttribute("part",i?"button current-button":"button page-button"),o.setAttribute("aria-label",i?`Page ${e}, current page`:`Go to page ${e}`),o.setAttribute("aria-current",i?"page":"false"),o.disabled=this.disabled||i,o.textContent=String(e),o.addEventListener("click",()=>this.goToPage(e)),r.append(o),r}#o(){let e=document.createElement("li");e.className="item",e.setAttribute("part","item ellipsis-item");let i=document.createElement("span");return i.className="ellipsis",i.setAttribute("part","ellipsis"),i.setAttribute("aria-hidden","true"),i.textContent="...",e.append(i),e}get listElement(){return this.shadowRoot?.querySelector(".list")??null}};c(Ft.prototype,"label");c({mode:"boolean"})(Ft.prototype,"disabled");c({attribute:"page",converter:Yo})(Ft.prototype,"page");c({attribute:"page-count",converter:Yo})(Ft.prototype,"pageCount");c({attribute:"sibling-count",converter:Yo})(Ft.prototype,"siblingCount");c({attribute:"boundary-count",converter:Yo})(Ft.prototype,"boundaryCount");customElements.get("violet-pagination")||await f.define(Ft,{name:"violet-pagination",template:sv,styles:ov});function nv(t,e,i,r){let o=Sn(1,Math.min(r,e)),s=Sn(Math.max(e-r+1,r+1),e),n=Math.max(Math.min(t-i,e-r-i*2-1),r+2),a=Math.min(Math.max(t+i,r+i*2+2),s.length>0?s[0]-2:e-1),l=[];return l.push(...o),n>r+2?l.push("ellipsis"):e>r+1&&l.push(r+1),l.push(...Sn(n,a)),a<e-r-1?l.push("ellipsis"):e-r>r&&l.push(e-r),l.push(...s),Array.from(new Set(l))}function Sn(t,e){return e<t?[]:Array.from({length:e-t+1},(i,r)=>t+r)}function pu(t,e,i){return Math.min(Math.max(t,e),i)}function Go(t,e,i){let r=t.getAttribute(e);if(!r)return i;let o=Number.parseInt(r,10);return Number.isFinite(o)?o:i}var av=v`
    ${F}

    :host {
        display: grid;
        gap: var(--_space-stack-xs);
        color: var(--_text-secondary);
        --_progress-track-size: 8px;
        --_progress-radius: var(--_radius-md);
        --_progress-fill: var(--color-control-selected-foreground, #244635);
        --_progress-track: color-mix(in srgb, var(--_surface-subtle) 84%, transparent);
    }

    .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--_space-inline-md);
    }

    .label,
    .value-label {
        margin: 0;
        font-size: var(--_control-label-size);
        line-height: var(--_type-label-line);
    }

    .label {
        color: var(--_text-secondary);
        font-weight: var(--_type-label-weight);
    }

    .value-label {
        color: var(--_text-muted);
    }

    .progress {
        inline-size: 100%;
        block-size: var(--_progress-track-size);
        overflow: hidden;
        border: none;
        border-radius: var(--_progress-radius);
        background: var(--_progress-track);
        appearance: none;
        -webkit-appearance: none;
    }

    .progress::-webkit-progress-bar {
        background: var(--_progress-track);
        border-radius: var(--_progress-radius);
    }

    .progress::-webkit-progress-value {
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
    }

    .progress::-moz-progress-bar {
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
    }

    :host([value=""]) .progress {
        position: relative;
        background: var(--_progress-track);
    }

    :host([value=""]) .progress::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inline-size: 35%;
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
        animation: indeterminate-slide 2.4s var(--_easing-standard) infinite;
    }

    @keyframes indeterminate-slide {
        0% {
            inset-inline-start: -35%;
        }

        100% {
            inset-inline-start: 100%;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        :host([value=""]) .progress::before {
            animation-duration: 3.2s;
        }
    }

    @media (forced-colors: active) {
        .progress {
            forced-color-adjust: none;
            background: Canvas;
            border: 1px solid ButtonText;
        }

        .progress::-webkit-progress-bar {
            background: Canvas;
        }

        .progress::-webkit-progress-value,
        .progress::-moz-progress-bar,
        :host([value=""]) .progress::before {
            background: Highlight;
        }
    }
`,lv=u`
    ${b(t=>!!t.label||t.showValueLabel,u`
            <div class="header" part="header">
                ${b(t=>!!t.label,u`
                        <p class="label" part="label">${t=>t.label}</p>
                    `)}
                ${b(t=>t.showValueLabel,u`
                        <p class="value-label" part="value-label">${t=>t.valueLabel}</p>
                    `)}
            </div>
        `)}
    <progress
        class="progress"
        part="progress"
        max="${t=>t.normalizedMax}"
        value="${t=>t.progressValueAttribute}"
        aria-label="${t=>t.accessibleLabel}"
        aria-valuetext="${t=>t.valueText||null}"
    ></progress>
`,hi=class extends f{constructor(){super(),this.label="",this.value="0",this.max="100",this.valueText=""}get normalizedMax(){R.trackVolatile();let e=Number.parseFloat(this.max);return Number.isFinite(e)&&e>0?String(e):"100"}get progressValueAttribute(){if(R.trackVolatile(),this.value==="")return null;let e=Number.parseFloat(this.value);return Number.isFinite(e)?String(Math.min(Math.max(e,0),Number.parseFloat(this.normalizedMax))):"0"}get accessibleLabel(){return R.trackVolatile(),this.label||"Progress"}get showValueLabel(){return R.trackVolatile(),this.value!==""}get valueLabel(){if(R.trackVolatile(),!this.showValueLabel)return"";let e=Number.parseFloat(this.progressValueAttribute??"0"),i=Number.parseFloat(this.normalizedMax);return`${i>0?Math.round(e/i*100):0}%`}};c(hi.prototype,"label");c(hi.prototype,"value");c(hi.prototype,"max");c({attribute:"value-text"})(hi.prototype,"valueText");customElements.get("violet-progress")||await f.define(hi,{name:"violet-progress",template:lv,styles:av});var fu=0,cv=v`
    ${E}

    :host {
        display: inline-block;
        position: relative;

        --_popover-padding: var(--violet-popover-padding, var(--_space-md));
        --_popover-min-inline: var(--violet-popover-min-inline-size, 16rem);
        --_popover-max-inline: var(--violet-popover-max-inline-size, min(24rem, calc(100vw - 24px)));
        --_popover-radius: var(--violet-popover-radius, calc(var(--_radius-md) * 2));
        --_popover-background: var(--violet-popover-background, var(--_surface-card));
        --_popover-shadow: var(--violet-popover-shadow, var(--_shadow-floating));
        --_popover-border: var(--violet-popover-border, var(--_border-subtle));
        --_popover-gap: var(--violet-popover-gap, var(--_space-sm));
    }

    .anchor {
        display: inline-block;
        anchor-name: --violet-popover-anchor;
    }

    .surface {
        box-sizing: border-box;
        position: fixed;
        position-anchor: --violet-popover-anchor;
        inset: unset;
        margin: 0;
        min-inline-size: var(--_popover-min-inline);
        max-inline-size: var(--_popover-max-inline);
        padding: var(--_popover-padding);
        border: 1px solid var(--_popover-border);
        border-radius: var(--_popover-radius);
        background: var(--_popover-background);
        box-shadow: var(--_popover-shadow);
        color: inherit;
        font-family: inherit;
        z-index: var(--_layer-popover);

        opacity: 0;
        transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .surface:popover-open {
        opacity: 1;
        transform: translateY(0) scale(1);

        @starting-style {
            opacity: 0;
            transform: translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
        }
    }

    :host([positioning="above"]) .surface {
        position-area: block-start center;
        margin-block-end: var(--_popover-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="below"]) .surface {
        position-area: block-end center;
        margin-block-start: var(--_popover-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="before"]) .surface {
        position-area: center left;
        margin-inline-end: var(--_popover-gap);
        position-try-fallbacks: flip-inline;
    }

    :host([positioning="after"]) .surface {
        position-area: center right;
        margin-inline-start: var(--_popover-gap);
        position-try-fallbacks: flip-inline;
    }

    .surface::backdrop {
        background: transparent;
    }

    @media (forced-colors: active) {
        .surface {
            forced-color-adjust: none;
            background: Canvas;
            color: CanvasText;
            border-color: ButtonText;
            box-shadow: none;
        }
    }
`,dv=u`
    <span class="anchor" part="anchor">
        <slot name="trigger" @click="${t=>t.handleTriggerClick()}"></slot>
    </span>
    <div
        class="surface"
        part="surface"
        id="${t=>t.surfaceId}"
        popover="auto"
        @toggle="${(t,e)=>t.handleToggle(e.event)}"
    >
        <slot></slot>
    </div>
`,rr=class extends f{#e;#t;constructor(){super(),this.#e=null,this.#t=!1,this.handleTriggerClickBound=()=>{this.handleTriggerClick()};let e=fu;fu+=1,this.surfaceId=`violet-popover-${e}`,this.open=!1,this.positioning="below",this.anchor=""}connectedCallback(){super.connectedCallback(),this.resolveExternalAnchor(),this.open&&this.show()}disconnectedCallback(){super.disconnectedCallback(),this.detachExternalAnchor()}openChanged(){this.$fastController.isConnected&&(this.open?this.show():this.hide())}anchorChanged(){this.$fastController.isConnected&&(this.detachExternalAnchor(),this.resolveExternalAnchor())}show(){this.surfaceElement?.showPopover()}hide(){this.surfaceElement?.matches(":popover-open")&&this.surfaceElement.hidePopover()}toggle(){this.surfaceElement?.togglePopover()}handleTriggerClick(){this.toggle()}handleToggle(e){let i=e.newState==="open";this.open=i,this.$emit("open-change",{open:i})}get surfaceElement(){return this.shadowRoot?.querySelector(".surface")??null}resolveExternalAnchor(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#e=e,e.style.setProperty("anchor-name","--violet-popover-anchor"),e.addEventListener("click",this.handleTriggerClickBound),this.#t=!0)}detachExternalAnchor(){!this.#t||!this.#e||(this.#e.removeEventListener("click",this.handleTriggerClickBound),this.#e.style.removeProperty("anchor-name"),this.#e=null,this.#t=!1)}};c({mode:"boolean"})(rr.prototype,"open");c(rr.prototype,"positioning");c(rr.prototype,"anchor");customElements.get("violet-popover")||await f.define(rr,{name:"violet-popover",template:dv,styles:cv});var mu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},uv=v`
    ${F}

    :host {
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-2xs);
    }

    .group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-stack-sm) calc(var(--_space-inline-md) * 2);
        align-items: start;
        min-inline-size: 0;
    }

    :host([orientation="vertical"]) .group {
        flex-direction: column;
        align-items: stretch;
        gap: var(--_space-stack-xs);
    }

    .supporting {
        margin: 0;
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-xs);
    }

    .error {
        margin: 0;
        color: var(--color-state-danger-foreground, #b42318);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        margin-block-start: var(--_space-stack-xs);
    }
`,hv=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <div class="label" part="label">${t=>t.label}</div>
            `)}
        <div class="group" part="group">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.validationMessageText,u`
                <p class="error" part="error-message">${t=>t.validationMessageText}</p>
            `)}
    </div>
`,xe=class extends f{static{this.formAssociated=!0}#e;#t;#i;constructor(){super(),this.handleRadioChange=e=>{let i=this.#l(e);i&&(this.#i||this.#a(i,{emitChange:!0,focus:!1}))},this.handleKeydown=e=>{let i=this.#l(e);if(!i||this.effectiveDisabled)return;let r=this.#s();if(!r.length)return;let o=r.indexOf(i);switch(Le(e.key,this)){case"ArrowDown":case"ArrowRight":{e.preventDefault();let s=o>=0?(o+1)%r.length:0;this.#a(r[s],{emitChange:!0,focus:!0});break}case"ArrowUp":case"ArrowLeft":{e.preventDefault();let s=o>=0?(o-1+r.length)%r.length:r.length-1;this.#a(r[s],{emitChange:!0,focus:!0});break}case"Home":{e.preventDefault(),this.#a(r[0],{emitChange:!0,focus:!0});break}case"End":{e.preventDefault(),this.#a(r[r.length-1],{emitChange:!0,focus:!0});break}case" ":case"Enter":{e.preventDefault(),this.#a(i,{emitChange:!0,focus:!0});break}default:break}},this.#e=this.attachInternals(),this.#e.role="radiogroup",this.#t="",this.#i=!1,this.radios=[],this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.disabled=!1,this.invalid=!1,this.required=!1,this.orientation="vertical"}connectedCallback(){super.connectedCallback(),this.addEventListener("change",this.handleRadioChange),this.addEventListener("keydown",this.handleKeydown),this.handleSlotChange(),this.#t=this.value,this.#c(),this.#d()}disconnectedCallback(){this.removeEventListener("change",this.handleRadioChange),this.removeEventListener("keydown",this.handleKeydown),super.disconnectedCallback()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#o()}handleSlotChange(){this.radios=this.#r(),this.#o()}radiosChanged(){this.#o()}labelChanged(){this.#c()}supportingTextChanged(){this.#c()}errorTextChanged(){this.#d()}valueChanged(){this.#i||this.#o()}nameChanged(){this.#o()}disabledChanged(){this.#o()}invalidChanged(){this.#c(),this.#d()}requiredChanged(){this.#c(),this.#d()}orientationChanged(){this.#c()}#r(){return Array.from(this.querySelectorAll("violet-radio")).filter(e=>e.closest("violet-radio-group")===this)}#n(){if(this.value){let e=this.radios.find(i=>i.value===this.value);if(e)return e}return this.radios.find(e=>e.checked)??null}#s(){return this.radios.filter(e=>!e.effectiveDisabled)}#o(e={}){if(!this.$fastController.isConnected)return;let i=this.#n(),r=i?.value??"",o=this.#s(),s=(!e.focusTarget||e.focusTarget.effectiveDisabled?null:e.focusTarget)??(i&&!i.effectiveDisabled?i:null)??o[0]??null;this.#i=!0,this.radios.forEach(n=>{customElements.upgrade(n),typeof n.setGroupDisabled=="function"&&(n.setGroupDisabled(this.effectiveDisabled),this.name&&(n.name=this.name),n.setCheckedFromGroup(!!i&&n===i),n.setManagedTabIndex(s&&n===s?0:-1))}),this.value=r,this.#i=!1,this.#c(),this.#d()}#a(e,i={}){if(!this.radios.includes(e)||e.effectiveDisabled)return;let r=this.value;this.value=e.value,this.#o({focusTarget:e}),i.focus&&e.focus(),i.emitChange&&this.value!==r&&this.$emit("change",{value:this.value})}#l(e){let i=e.composedPath();for(let r of i)if(r instanceof HTMLElement&&r.tagName.toLowerCase()==="violet-radio")return r;return null}#c(){this.#e.ariaDisabled=this.effectiveDisabled?"true":"false",this.#e.ariaOrientation=this.orientation,this.#e.ariaRequired=this.required?"true":"false";let e=this.shadowRoot?.querySelector(".label"),i=this.shadowRoot?.querySelector(".supporting"),r=this.shadowRoot?.querySelector(".error");e instanceof Element&&!this.getAttribute("aria-label")?(this.#e.ariaLabelledByElements=[e],this.#e.ariaLabel=null):(this.#e.ariaLabelledByElements=null,this.#e.ariaLabel=this.getAttribute("aria-label")||this.label||null),this.#e.ariaDescribedByElements=i instanceof Element?[i]:null,this.#e.ariaErrorMessageElements=r instanceof Element?[r]:null}#d(){if(this.#e.setFormValue(this.effectiveDisabled||!this.value?null:this.value),this.effectiveDisabled){this.validationMessageText="",this.#e.setValidity({}),this.#e.ariaInvalid="false";return}if(this.invalid){this.validationMessageText=this.errorText||"Please select a valid option.",this.#e.setValidity({customError:!0},this.validationMessageText),this.#e.ariaInvalid="true",this.#c();return}if(this.required&&!this.value){this.validationMessageText=this.errorText||"Please select an option.",this.#e.setValidity({valueMissing:!0},this.validationMessageText),this.#e.ariaInvalid="true",this.#c();return}this.validationMessageText="",this.#e.setValidity({}),this.#e.ariaInvalid="false",this.#c()}};mu([m],xe.prototype,"radios",void 0);mu([m],xe.prototype,"validationMessageText",void 0);c(xe.prototype,"label");c({attribute:"supporting-text"})(xe.prototype,"supportingText");c({attribute:"error-text"})(xe.prototype,"errorText");c(xe.prototype,"value");c(xe.prototype,"name");c({mode:"boolean"})(xe.prototype,"disabled");q(xe.prototype);c({mode:"boolean"})(xe.prototype,"invalid");c({mode:"boolean"})(xe.prototype,"required");c(xe.prototype,"orientation");customElements.get("violet-radio-group")||await f.define(xe,{name:"violet-radio-group",template:hv,styles:uv,shadowOptions:{delegatesFocus:!0}});var $n=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},pi=0;function gu(t){return t.isComposing||t.keyCode===229}var pv=v`
    ${F}

    :host {
        position: relative;
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .trigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        border-color: var(--_field-border-hover);
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .trigger,
    :host(:disabled) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .value {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .value[data-placeholder="true"] {
        color: var(--_text-muted);
    }

    .caret {
        inline-size: 0.5rem;
        block-size: 0.5rem;
        flex: 0 0 auto;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        transform: translateY(-1px) rotate(45deg);
        opacity: 0.8;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        max-block-size: min(18rem, 60vh);
        padding: var(--_space-inline-sm);
        border: thin solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 2);
        overflow: hidden;
        background: var(--_surface-card);
        box-shadow: var(--_shadow-floating);
        color: inherit;
    }

    .panel[hidden] {
        display: none;
    }

    .listbox {
        display: grid;
        gap: 2px;
        max-block-size: inherit;
        overflow: auto;
        outline: none;
    }

    .listbox:focus-visible {
        outline: none;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .trigger,
        .panel {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }

        .trigger:focus-visible,
        .control-shell.open .trigger {
            box-shadow: 0 0 0 2px Highlight;
            border-color: Highlight;
        }
    }
`,fv=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
            `)}
        <div
            class="control-shell"
            part="control-shell"
            @focusout="${(t,e)=>t.handleControlFocusOut(e.event)}"
        >
            <button
                id="${t=>t.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${t=>t.effectiveDisabled}"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-controls="${t=>t.listboxId}"
                aria-labelledby="${t=>t.label?`${t.labelId} ${t.valueId}`:t.valueId}"
                aria-describedby="${t=>t.describedBy||null}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @click="${t=>t.handleTriggerClick()}"
                @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
            >
                <span id="${t=>t.valueId}" class="value" data-placeholder="${t=>String(!t.selectedLabel&&!t.value)}">
                    ${t=>t.selectedLabel||t.value||t.placeholder||"Select an option"}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </button>

            <div class="panel" part="panel" hidden>
                <div
                    id="${t=>t.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    tabindex="-1"
                    aria-labelledby="${t=>t.label?`${t.labelId} ${t.valueId}`:t.valueId}"
                    @keydown="${(t,e)=>t.handleListboxKeydown(e.event)}"
                >
                    <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
                </div>
            </div>
        </div>

        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.displayErrorText,u`
                <p class="error" part="error-message" id="${t=>t.errorId}">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,he=class extends f{static{this.formAssociated=!0}#e;#t;#i="";#r=0;#n=()=>{this.open&&this.#h()};#s=e=>{this.open&&(e.composedPath().includes(this)||this.hide())};#o=e=>{this.handleControlFocusOut(e)};constructor(){super(),this.#e=this.attachInternals(),this.#t="",this.open=!1,this.validationMessageText="",this.label="",this.placeholder="",this.supportingText="",this.errorText="",this.value="",this.activeValue="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,pi+=1,this.triggerId=`violet-select-trigger-${pi}`,this.labelId=`violet-select-label-${pi}`,this.valueId=`violet-select-value-${pi}`,this.listboxId=`violet-select-listbox-${pi}`,this.supportingId=`violet-select-supporting-${pi}`,this.errorId=`violet-select-error-${pi}`}connectedCallback(){super.connectedCallback(),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.addEventListener("request-select",this.handleRequestSelect),this.addEventListener("focusout",this.#o),this.ownerDocument.addEventListener("pointerdown",this.#s,!0),window.addEventListener("resize",this.#n),window.addEventListener("scroll",this.#n,!0),this.handleSlotChange(),this.#t=this.value,this.#y(),this.openChanged()}disconnectedCallback(){this.removeEventListener("request-select",this.handleRequestSelect),this.removeEventListener("focusout",this.#o),this.ownerDocument.removeEventListener("pointerdown",this.#s,!0),window.removeEventListener("resize",this.#n),window.removeEventListener("scroll",this.#n,!0),super.disconnectedCallback()}get options(){return ji(this)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get selectedLabel(){return this.options.find(e=>e.value===this.value)?.labelText??""}get activeOptionId(){return this.options.find(e=>e.value===this.activeValue)?.optionId??""}get describedBy(){return[this.supportingText?this.supportingId:"",this.displayErrorText?this.errorId:""].filter(Boolean).join(" ")}get displayErrorText(){return!this.effectiveDisabled&&(this.invalid||this.required&&!this.value)?this.errorText||"Please select an option.":""}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.handleSlotChange()}handleSlotChange(){let e=ci(this.options,this.value),i=oe(this.options);this.value||(this.value=e?.value??""),(!this.activeValue||!i.some(r=>r.value===this.activeValue))&&(this.activeValue=e?.value??i[0]?.value??""),this.#b(),this.#y()}handleTriggerClick(){this.effectiveDisabled||(this.open?this.hide():this.show())}handleTriggerKeydown(e){if(gu(e)||this.effectiveDisabled)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.show(),this.#l(1),!1;case"ArrowUp":return e.preventDefault(),this.show(),this.#l(-1),!1;case"Enter":case" ":return e.preventDefault(),this.show(),!1;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#d(e.key),!0}}handleListboxKeydown(e){if(gu(e)||!this.open)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#l(1),!1;case"ArrowUp":return e.preventDefault(),this.#l(-1),!1;case"Home":return e.preventDefault(),this.#c(oe(this.options)[0]?.value??""),!1;case"End":{e.preventDefault();let i=oe(this.options);return this.#c(i.at(-1)?.value??""),!1}case"Enter":case" ":{let i=oe(this.options).find(r=>r.value===this.activeValue);return i?(e.preventDefault(),this.selectValue(i.value),!1):!0}case"Escape":return e.preventDefault(),this.hide(),this.#a(),!1;case"Tab":return!0;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#d(e.key),!0}}handleControlFocusOut(e){let i=e.relatedTarget;return i&&(i===this||this.shadowRoot?.contains(i)||this.contains(i))||this.hide(),!0}handleRequestSelect(e){e.stopPropagation();let i=e.detail?.value??"";this.selectValue(i)}valueChanged(){this.#b(),this.#y()}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name)}openChanged(){let e=this.#p,i=this.#f,r=this.#v,o=this.#m;e?.classList.toggle("open",this.open),i?.toggleAttribute("hidden",!this.open),r?.setAttribute("aria-expanded",String(this.open)),r&&(r.tabIndex=this.open?-1:0),o&&(o.tabIndex=this.open?0:-1,this.open&&requestAnimationFrame(()=>{this.#h(),this.#m?.focus(),this.#u()}))}requiredChanged(){this.#y()}disabledChanged(){this.#y()}invalidChanged(){this.#y()}errorTextChanged(){this.#y()}show(){this.effectiveDisabled||this.open||(this.open=!0,this.activeValue=this.value||oe(this.options)[0]?.value||"")}hide(){this.open=!1}selectValue(e){let i=oe(this.options).find(r=>r.value===e)??null;i&&(this.value=i.value,this.activeValue=i.value,this.hide(),this.#b(),this.#y(),this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value}),this.#a())}#a(){this.#v?.focus()}#l(e){let i=this.options,r=i.findIndex(s=>s.value===this.activeValue),o=Hi(i,r<0?e===1?-1:0:r,e);this.#c(i[o]?.value??"")}#c(e){this.activeValue=e,this.#b(),this.#u()}#d(e){window.clearTimeout(this.#r),this.#i=`${this.#i}${e.toLowerCase()}`;let i=oe(this.options),r=i.findIndex(n=>n.value===this.activeValue),s=(r>=0?[...i.slice(r+1),...i.slice(0,r+1)]:i).find(n=>Ee(n.labelText).startsWith(Ee(this.#i)));s&&(this.open?this.#c(s.value):this.selectValue(s.value)),this.#r=window.setTimeout(()=>{this.#i=""},500)}#u(){this.options.find(i=>i.value===this.activeValue)?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#h(){let e=this.#f,i=this.#v;if(!e||!i)return;let r=i.getBoundingClientRect(),o=4,s=-1,n=r.left,a=r.bottom+s,l=Math.min(r.width,window.innerWidth-o*2);e.style.width=`${l}px`,e.style.left=`${Math.max(o,n)}px`,e.style.top=`${Math.max(o,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-o&&(n=Math.max(o,window.innerWidth-d.width-o)),d.bottom>window.innerHeight-o&&(a=Math.max(o,r.top-d.height+1)),e.style.left=`${n}px`,e.style.top=`${a}px`})}get#p(){return this.shadowRoot?.querySelector(".control-shell")??null}get#f(){return this.shadowRoot?.querySelector(".panel")??null}get#m(){return this.shadowRoot?.querySelector('[role="listbox"]')??null}get#v(){return this.shadowRoot?.querySelector(".trigger")??null}#b(){qi(this.options,this.value,this.activeValue);let e=this.#m;e&&(e.ariaActiveDescendantElement=this.options.find(i=>i.value===this.activeValue)??null)}#y(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector(".trigger"),i=this.displayErrorText||this.errorText||"Please select an option.",r=!this.effectiveDisabled&&!!this.displayErrorText;if(this.validationMessageText=this.displayErrorText,this.#e.ariaInvalid=r?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:this.value||null,this.effectiveDisabled?null:this.value||null),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},i,e??void 0);return}if(this.required&&!this.value){this.#e.setValidity({valueMissing:!0},i,e??void 0);return}this.#e.setValidity({})}};$n([m],he.prototype,"open",void 0);$n([m],he.prototype,"validationMessageText",void 0);$n([m],he.prototype,"activeValue",void 0);c(he.prototype,"label");c(he.prototype,"placeholder");c({attribute:"supporting-text"})(he.prototype,"supportingText");c({attribute:"error-text"})(he.prototype,"errorText");c(he.prototype,"value");c(he.prototype,"name");c({mode:"boolean"})(he.prototype,"required");c({mode:"boolean"})(he.prototype,"disabled");q(he.prototype);c({mode:"boolean"})(he.prototype,"invalid");c({mode:"boolean"})(he.prototype,"open");customElements.get("violet-select")||await f.define(he,{name:"violet-select",template:fv,styles:pv,shadowOptions:{delegatesFocus:!0}});var Xo=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},or=0,mv=v`
    ${F}

    :host {
        position: relative;
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .control-shell {
        position: relative;
        display: grid;
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within,
    .control-shell.open .control-frame {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    .input {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
        outline: none;
    }

    .input::placeholder {
        color: var(--_text-muted);
    }

    .caret {
        inline-size: 0.5rem;
        block-size: 0.5rem;
        flex: 0 0 auto;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        transform: translateY(-1px) rotate(45deg);
        opacity: 0.8;
        pointer-events: none;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        max-block-size: min(18rem, 60vh);
        padding: var(--_space-inline-sm);
        border: thin solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 2);
        overflow: hidden;
        background: var(--_surface-card);
        box-shadow: var(--_shadow-floating);
        color: inherit;
    }

    .panel[hidden] {
        display: none;
    }

    .listbox {
        display: grid;
        gap: 2px;
        max-block-size: inherit;
        overflow: auto;
    }

    .empty {
        padding: var(--_space-inline-sm) var(--_space-inline-md);
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within,
        .control-shell.open .control-frame {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`,gv=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
            `)}
        <div class="control-shell" part="control-shell">
            <div class="control-frame" part="control-frame">
                <input
                    id="${t=>t.inputId}"
                    class="input"
                    part="input"
                    type="text"
                    name="${t=>t.name}"
                    placeholder="${t=>t.placeholder}"
                    :value="${t=>t.value}"
                    ?disabled="${t=>t.effectiveDisabled}"
                    ?required="${t=>t.required}"
                    role="combobox"
                    autocomplete="off"
                    aria-autocomplete="list"
                    aria-expanded="false"
                    aria-controls="${t=>t.listboxId}"
                    aria-labelledby="${t=>t.label?t.labelId:null}"
                    aria-describedby="${t=>t.describedBy||null}"
                    aria-invalid="${t=>t.invalid?"true":"false"}"
                    @focus="${t=>t.handleInputFocus()}"
                    @focusout="${(t,e)=>t.handleFocusOut(e.event)}"
                    @input="${(t,e)=>t.handleInput(e.event)}"
                    @change="${(t,e)=>t.handleCommit(e.event)}"
                    @keydown="${(t,e)=>t.handleKeydown(e.event)}"
                />
                <span class="caret" part="caret" aria-hidden="true"></span>
            </div>

            <div class="panel" part="panel" hidden>
                <div
                    id="${t=>t.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    aria-label="${t=>t.label||t.placeholder||"Options"}"
                >
                    <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
                </div>
                ${b(t=>t.visibleOptions.length===0,u`
                        <div class="empty" part="empty-state">No matching options</div>
                    `)}
            </div>
        </div>

        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.displayErrorText,u`
                <p class="error" part="error-message" id="${t=>t.errorId}">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,ae=class extends f{static{this.formAssociated=!0}#e;#t;#i;#r=()=>{this.open&&this.#c()};#n=e=>{this.open&&(e.composedPath().includes(this)||this.hide(!0))};constructor(){super(),this.#e=this.attachInternals(),this.#t="",this.#i="",this.open=!1,this.validationMessageText="",this.label="",this.placeholder="",this.supportingText="",this.errorText="",this.value="",this.activeValue="",this.selectedOptionValue="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,or+=1,this.inputId=`violet-combobox-input-${or}`,this.labelId=`violet-combobox-label-${or}`,this.listboxId=`violet-combobox-listbox-${or}`,this.supportingId=`violet-combobox-supporting-${or}`,this.errorId=`violet-combobox-error-${or}`}connectedCallback(){super.connectedCallback(),this.addEventListener("request-select",this.handleRequestSelect),this.ownerDocument.addEventListener("pointerdown",this.#n,!0),window.addEventListener("resize",this.#r),window.addEventListener("scroll",this.#r,!0),this.handleSlotChange(),this.#t=this.getAttribute("value")??this.value,this.#i=this.selectedOptionValue,this.#f(),this.openChanged()}disconnectedCallback(){this.removeEventListener("request-select",this.handleRequestSelect),this.ownerDocument.removeEventListener("pointerdown",this.#n,!0),window.removeEventListener("resize",this.#r),window.removeEventListener("scroll",this.#r,!0),super.disconnectedCallback()}get options(){return ji(this)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get visibleOptions(){let e=Ee(this.value.trim());return e?this.options.filter(i=>Ee(i.labelText).includes(e)):this.options}get activeOptionId(){return this.visibleOptions.find(e=>e.value===this.activeValue)?.optionId??""}get describedBy(){return[this.supportingText?this.supportingId:"",this.displayErrorText?this.errorId:""].filter(Boolean).join(" ")}get displayErrorText(){let e=this.selectedOptionValue||this.value;return!this.effectiveDisabled&&(this.invalid||this.required&&!e.trim())?this.errorText||"Please choose an option.":""}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.selectedOptionValue=this.#i,this.activeValue="",this.open=!1,this.options.forEach(e=>{e.selected=!1}),this.handleSlotChange()}handleSlotChange(){let e=ci(this.options,this.selectedOptionValue||this.value),i=e??this.options.find(o=>!Ni(o)&&Ee(o.labelText)===Ee(this.value))??null,r=e??i;r?(this.selectedOptionValue=r.value,(!this.open||!this.value||this.value===r.value||Ee(this.value)===Ee(r.labelText))&&(this.value=r.labelText)):!this.open&&!this.value&&(this.selectedOptionValue=""),(!this.activeValue||!this.visibleOptions.some(o=>o.value===this.activeValue))&&(this.activeValue=this.visibleOptions[0]?.value??""),this.#a(),this.#f()}handleInputFocus(){this.effectiveDisabled||this.show()}handleFocusOut(e){let i=e.relatedTarget;return this.open&&i&&!this.contains(i)&&!this.shadowRoot?.contains(i)&&this.hide(!0),!0}handleInput(e){let i=e.currentTarget;this.value=i?.value??"",this.open=!0;let r=this.options.find(o=>o.value===this.selectedOptionValue)?.labelText??"";Ee(r)!==Ee(this.value)&&(this.selectedOptionValue=""),this.activeValue=this.visibleOptions[0]?.value??"",this.#a(),this.#f(),this.$emit("input",{value:this.value,selectedValue:this.selectedOptionValue})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#f(),this.$emit("change",{value:this.value,selectedValue:this.selectedOptionValue})}handleKeydown(e){switch(e.key){case"ArrowDown":return e.preventDefault(),this.show(),this.#s(1),!1;case"ArrowUp":return e.preventDefault(),this.show(),this.#s(-1),!1;case"Enter":if(this.open&&this.activeValue)return e.preventDefault(),this.selectValue(this.activeValue),!1;break;case"Tab":this.open&&this.hide(!0);break;case"Escape":if(this.open)return e.preventDefault(),this.hide(!0),!1;break}return!0}handleRequestSelect(e){e.stopPropagation();let i=e.detail?.value??"";this.selectValue(i)}valueChanged(){this.#a(),this.#f()}requiredChanged(){this.#f()}disabledChanged(){this.#f()}invalidChanged(){this.#f()}errorTextChanged(){this.#f()}openChanged(){let e=this.#d,i=this.#u,r=this.#p;e?.classList.toggle("open",this.open),i?.toggleAttribute("hidden",!this.open),r?.setAttribute("aria-expanded",String(this.open)),this.open&&requestAnimationFrame(()=>{this.#c()})}show(){if(this.effectiveDisabled)return;let e=this.open;this.open=!0;let i=this.visibleOptions.some(r=>r.value===this.activeValue);(!e||!i)&&(this.activeValue=this.selectedOptionValue||this.visibleOptions[0]?.value||this.activeValue),this.#a()}hide(e){if(this.open=!1,e){let i=this.options.find(r=>r.value===this.selectedOptionValue);this.value=i?.labelText??""}this.#a(),this.#f()}selectValue(e){let i=oe(this.options).find(r=>r.value===e)??null;i&&(this.selectedOptionValue=i.value,this.value=i.labelText,this.activeValue=i.value,this.hide(!1),this.#a(),this.#f(),this.$emit("change",{value:this.value,selectedValue:i.value,label:i.labelText}))}#s(e){let i=this.visibleOptions,r=i.findIndex(s=>s.value===this.activeValue),o=Hi(i,r<0?e===1?-1:0:r,e);this.activeValue=i[o]?.value??"",this.#a(),this.#o()}#o(){this.visibleOptions.find(i=>i.value===this.activeValue)?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#a(){let e=new Set(this.visibleOptions.map(i=>i.value));for(let i of this.options)i.hidden=!e.has(i.value);qi(this.options,this.selectedOptionValue,this.activeValue),this.#l()}#l(){let e=this.#p;e&&(e.ariaActiveDescendantElement=this.open?this.visibleOptions.find(i=>i.value===this.activeValue)??null:null)}#c(){let e=this.#u,i=this.#h;if(!e||!i)return;let r=i.getBoundingClientRect(),o=4,s=-1,n=r.left,a=r.bottom+s,l=Math.min(r.width,window.innerWidth-o*2);e.style.width=`${l}px`,e.style.left=`${Math.max(o,n)}px`,e.style.top=`${Math.max(o,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-o&&(n=Math.max(o,window.innerWidth-d.width-o)),d.bottom>window.innerHeight-o&&(a=Math.max(o,r.top-d.height+1)),e.style.left=`${n}px`,e.style.top=`${a}px`})}get#d(){return this.shadowRoot?.querySelector(".control-shell")??null}get#u(){return this.shadowRoot?.querySelector(".panel")??null}get#h(){return this.shadowRoot?.querySelector(".control-frame")??null}get#p(){return this.shadowRoot?.querySelector('input[role="combobox"]')??null}#f(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[role="combobox"]'),i=this.displayErrorText||this.errorText||"Please choose an option.",r=this.effectiveDisabled?"":this.selectedOptionValue||this.value,o=!this.effectiveDisabled&&!!this.displayErrorText;if(this.validationMessageText=this.displayErrorText,this.#e.ariaInvalid=o?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:r||null,this.effectiveDisabled?null:r||null),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},i,e??void 0);return}if(this.required&&!r.trim()){this.#e.setValidity({valueMissing:!0},i,e??void 0);return}this.#e.setValidity({})}};Xo([m],ae.prototype,"open",void 0);Xo([m],ae.prototype,"validationMessageText",void 0);Xo([m],ae.prototype,"activeValue",void 0);Xo([m],ae.prototype,"selectedOptionValue",void 0);c(ae.prototype,"label");c(ae.prototype,"placeholder");c({attribute:"supporting-text"})(ae.prototype,"supportingText");c({attribute:"error-text"})(ae.prototype,"errorText");c({mode:"fromView"})(ae.prototype,"value");c(ae.prototype,"name");c({mode:"boolean"})(ae.prototype,"required");c({mode:"boolean"})(ae.prototype,"disabled");q(ae.prototype);c({mode:"boolean"})(ae.prototype,"invalid");c({mode:"boolean"})(ae.prototype,"open");customElements.get("violet-combobox")||await f.define(ae,{name:"violet-combobox",template:gv,styles:mv,shadowOptions:{delegatesFocus:!0}});var vv=v`
    ${Ce}
    ${E}

    :host {
        display: block;
        flex: 1 1 0;

        --_segment-selected-background: var(--violet-segment-selected-background, var(--_surface-page));
        --_segment-selected-border: var(--violet-segment-selected-border, var(--_border-subtle));
        --_segment-selected-shadow: var(--violet-segment-selected-shadow, var(--_shadow-control));
    }

    .button {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 100%;
        /* The group adds 2px padding and a 1px border per side, so the control matches a button's height. */
        min-block-size: calc(var(--_target-size) - 6px);
        padding: 0 var(--_space-md);
        border: 1px solid transparent;
        border-radius: calc(var(--_radius-md) - 2px);
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-size: var(--_control-body-size);
        font-weight: var(--_type-label-weight);
        /* Never taller than the target minus the group chrome and the border, so compact controls stay button-sized. */
        line-height: min(var(--_type-body-line), calc(var(--_target-size) - 8px));
        text-align: center;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard);
    }

    .button:hover {
        background: color-mix(in srgb, var(--_surface-page) 55%, transparent);
    }

    .button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    :host([checked]) .button {
        background: var(--_segment-selected-background);
        border-color: var(--_segment-selected-border);
        box-shadow: var(--_segment-selected-shadow);
        color: var(--color-text-primary, #18181b);
    }

    :host([disabled]) .button,
    :host([aria-disabled="true"]) .button {
        cursor: not-allowed;
        opacity: 0.6;
    }

    @media (forced-colors: active) {
        .button {
            forced-color-adjust: none;
            color: ButtonText;
        }

        :host([checked]) .button {
            background: Highlight;
            border-color: Highlight;
            color: HighlightText;
            box-shadow: none;
        }
    }
`,bv=u`
    <button
        class="button"
        part="button"
        type="button"
        role="radio"
        tabindex="${t=>String(t.buttonTabIndex)}"
        ?disabled="${t=>t.effectiveDisabled}"
        aria-checked="${t=>String(t.checked)}"
        @click="${t=>t.handleClick()}"
    >
        <slot></slot>
    </button>
`,sr=class extends f{#e;#t;constructor(){super(),this.#e=!1,this.#t=null,this.checked=!1,this.disabled=!1,this.value=""}disabledChanged(){this.$emit("disabled-change")}get effectiveDisabled(){return R.track(this,"effectiveDisabled"),this.disabled||this.#e}get buttonTabIndex(){return R.track(this,"buttonTabIndex"),this.#t??0}setManagedTabIndex(e){this.#t=e,R.notify(this,"buttonTabIndex")}setCheckedFromGroup(e){this.checked=e}setGroupDisabled(e){this.#e=e,R.notify(this,"effectiveDisabled"),this.ariaDisabled=e?"true":null}focusButton(){this.buttonElement?.focus()}handleClick(){this.effectiveDisabled||this.checked||this.$emit("select-request",{value:this.value})}get buttonElement(){return this.shadowRoot?.querySelector(".button")??null}};c({mode:"boolean"})(sr.prototype,"checked");c({mode:"boolean"})(sr.prototype,"disabled");c(sr.prototype,"value");customElements.get("violet-segment")||await f.define(sr,{name:"violet-segment",template:bv,styles:vv,shadowOptions:{delegatesFocus:!0}});var vu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},yv=v`
    ${F}

    :host {
        display: grid;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-2xs);
    }

    .group {
        display: inline-flex;
        align-items: stretch;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-lg);
        background: var(--_surface-subtle);
        box-shadow: var(--_shadow-control);
        min-inline-size: 0;
    }

    :host([disabled]) .group,
    :host(:disabled) .group {
        opacity: 0.7;
    }

    :host([invalid]) .group {
        border-color: var(--_danger-border);
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .group {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }
    }
`,xv=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <div class="label" part="label">${t=>t.label}</div>
            `)}
        <div class="group" part="group">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.validationMessageText,u`
                <p class="error" part="error-message">${t=>t.validationMessageText}</p>
            `)}
    </div>
`,Te=class extends f{static{this.formAssociated=!0}#e;#t;#i;constructor(){super(),this.#e=this.attachInternals(),this.#e.role="radiogroup",this.#t="",this.#i=!1,this.segments=[],this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.disabled=!1,this.invalid=!1,this.required=!1}connectedCallback(){super.connectedCallback(),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.addEventListener("select-request",this.handleSelectRequest),this.addEventListener("disabled-change",this.handleSegmentDisabledChange),this.addEventListener("keydown",this.handleKeydown),this.handleSlotChange(),this.#t=this.value,this.#n(),this.#s()}disconnectedCallback(){this.removeEventListener("select-request",this.handleSelectRequest),this.removeEventListener("disabled-change",this.handleSegmentDisabledChange),this.removeEventListener("keydown",this.handleKeydown),super.disconnectedCallback()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#r()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}handleSlotChange(){this.segments=this.#o(),this.#r()}valueChanged(){this.#i||this.#r()}labelChanged(){this.#n()}supportingTextChanged(){this.#n()}errorTextChanged(){this.#s()}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.#s()}disabledChanged(){this.#r()}invalidChanged(){this.#n(),this.#s()}requiredChanged(){this.#s()}handleSelectRequest(e){let i=e.target;!i||!this.segments.includes(i)||(this.value=e.detail?.value??i.value,this.#r(),this.$emit("change"))}handleSegmentDisabledChange(e){let i=e.target;i&&this.segments.includes(i)&&this.#r()}handleKeydown(e){let i=e.composedPath().find(a=>a instanceof HTMLElement&&a.tagName.toLowerCase()==="violet-segment");if(!i)return;let r=this.segments.filter(a=>!a.effectiveDisabled),o=r.indexOf(i);if(o<0)return;let s;switch(Le(e.key,this)){case"ArrowRight":case"ArrowDown":s=r[(o+1)%r.length];break;case"ArrowLeft":case"ArrowUp":s=r[(o-1+r.length)%r.length];break;case"Home":s=r[0];break;case"End":s=r.at(-1);break;default:return}if(e.preventDefault(),!s)return;let n=this.value;this.value=s.value,this.#r(),s.focusButton(),this.value!==n&&this.$emit("change")}#r(){this.#i=!0;let e=this.#o();this.segments=e;let i=s=>!!this.value&&s.value===this.value,r=this.effectiveDisabled?[]:e.filter(s=>!s.disabled),o=r.find(i)??r[0];for(let s of e)s.toggleAttribute("checked",i(s)),s.setGroupDisabled?.(this.effectiveDisabled),s.setManagedTabIndex?.(s===o?0:-1);this.#i=!1,this.#n(),this.#s()}#n(){let e=[];this.supportingText&&e.push("supporting-text"),this.invalid&&this.validationMessageText&&e.push("error-message"),this.#e.ariaLabel=this.label||null,this.#e.ariaDisabled=this.effectiveDisabled?"true":null,this.#e.ariaRequired=this.required?"true":null,this.#e.ariaInvalid=this.invalid?"true":null,this.#e.ariaDescribedByElements=e.map(i=>this.shadowRoot?.querySelector(`[part="${i}"]`)).filter(i=>i instanceof Element)}#s(){this.invalid?this.validationMessageText=this.errorText||"Please choose an option.":this.required&&!this.value?this.validationMessageText=this.errorText||"Please choose an option.":this.validationMessageText="",this.invalid||this.required&&!this.value?this.#e.setValidity({customError:this.invalid,valueMissing:this.required&&!this.value},this.validationMessageText):this.#e.setValidity({}),this.#e.setFormValue(this.value||null,this.value||null)}#o(){return Array.from(this.querySelectorAll("violet-segment")).filter(e=>e.closest("violet-segmented-control")===this)}};vu([m],Te.prototype,"segments",void 0);vu([m],Te.prototype,"validationMessageText",void 0);c(Te.prototype,"label");c({attribute:"supporting-text"})(Te.prototype,"supportingText");c({attribute:"error-text"})(Te.prototype,"errorText");c(Te.prototype,"value");c(Te.prototype,"name");c({mode:"boolean"})(Te.prototype,"disabled");q(Te.prototype);c({mode:"boolean"})(Te.prototype,"invalid");c({mode:"boolean"})(Te.prototype,"required");customElements.get("violet-segmented-control")||await f.define(Te,{name:"violet-segmented-control",template:xv,styles:yv});var Zt=0,wv=v`
    ${F}

    :host {
        display: grid;

        --_selection-fill: color-mix(in srgb, var(--color-control-selected-foreground, #244635) 50%, var(--color-control-selected-background, #ddeadf));
        --_rail-background: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_radius-full: var(--radius-round, 9999px);
        --_thumb-size: calc(var(--_target-size) * 0.625);
        --_track-size: calc(var(--_target-size) * 0.125);
        --_control-block-size: var(--_target-size);
        --_vertical-track-size: calc(var(--_target-size) * 4);
        --_tick-size: 6px;
        --_tick-color: var(--_rail-background);
        --_start-percent: 25%;
        --_end-percent: 75%;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        min-inline-size: 0;
        block-size: var(--_control-block-size);
        border-radius: var(--_radius-md);
    }

    :host([orientation="vertical"]) .control-shell {
        justify-items: center;
        inline-size: var(--_target-size);
        block-size: var(--_vertical-track-size);
    }

    .input {
        position: absolute;
        inset: 0;
        margin: 0;
        inline-size: 100%;
        block-size: 100%;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 0;
        opacity: 0;
        cursor: pointer;
        touch-action: none;
        pointer-events: none;
    }

    .input-start {
        pointer-events: auto;
        clip-path: inset(0 calc(100% - var(--_mid-percent)) 0 0);
    }

    .input-end {
        pointer-events: auto;
        clip-path: inset(0 0 0 var(--_mid-percent));
    }

    :host([orientation="vertical"]) .input {
        writing-mode: vertical-lr;
        direction: rtl;
    }

    :host([orientation="vertical"]) .input-start {
        clip-path: inset(calc(100% - var(--_mid-percent)) 0 0 0);
    }

    :host([orientation="vertical"]) .input-end {
        clip-path: inset(0 0 var(--_mid-percent) 0);
    }

    .visual {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        block-size: 100%;
        pointer-events: none;
    }

    :host([orientation="vertical"]) .visual {
        justify-items: center;
    }

    .rail {
        position: relative;
        inline-size: 100%;
        block-size: var(--_track-size);
        border-radius: var(--_radius-full);
        background: var(--_rail-background);
        overflow: hidden;
    }

    :host([orientation="vertical"]) .rail {
        inline-size: var(--_track-size);
        block-size: 100%;
    }

    .fill {
        position: absolute;
        inset-inline-start: var(--_start-percent);
        inset-block-start: 0;
        inline-size: calc(var(--_end-percent) - var(--_start-percent));
        block-size: 100%;
        border-radius: inherit;
        background: var(--_selection-fill);
    }

    :host([orientation="vertical"]) .fill {
        inset-inline-start: 0;
        inset-block-start: auto;
        inset-block-end: var(--_start-percent);
        inline-size: 100%;
        block-size: calc(var(--_end-percent) - var(--_start-percent));
    }

    .ticks {
        display: none;
        position: absolute;
        inset-inline: 0;
        block-size: var(--_tick-size);
        inset-block-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        pointer-events: none;
    }

    :host([show-ticks]) .ticks {
        display: block;
    }

    :host([orientation="vertical"]) .ticks {
        inset-block: 0;
        inset-inline: auto;
        inset-inline-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        inline-size: var(--_tick-size);
        block-size: auto;
    }

    .thumb {
        position: absolute;
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        border-radius: var(--_radius-full);
        background: var(--_surface-page);
        border: 1px solid var(--_border-subtle);
        box-shadow: var(--_shadow-floating);
        transform: translate(-50%, -50%);
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .thumb-start {
        inset-inline-start: var(--_start-percent);
    }

    .thumb-end {
        inset-inline-start: var(--_end-percent);
    }

    :host([orientation="vertical"]) .thumb {
        inset-inline-start: 50%;
        inset-block-start: auto;
        transform: translate(-50%, 50%);
    }

    :host([orientation="vertical"]) .thumb-start {
        inset-block-end: var(--_start-percent);
    }

    :host([orientation="vertical"]) .thumb-end {
        inset-block-end: var(--_end-percent);
    }

    .control-shell:has(.input-start:focus-visible) .thumb-start {
        box-shadow:
            var(--_shadow-floating),
            0 0 0 2px var(--_focus-ring);
    }

    .control-shell:has(.input-end:focus-visible) .thumb-end {
        box-shadow:
            var(--_shadow-floating),
            0 0 0 2px var(--_focus-ring);
    }

    :host([disabled]) .input,
    :host(:disabled) .input {
        cursor: not-allowed;
    }

    :host([disabled]) .control-shell,
    :host(:disabled) .control-shell {
        cursor: not-allowed;
    }

    :host([disabled]) .visual,
    :host(:disabled) .visual {
        opacity: 0.6;
    }

    :host([disabled]) .rail,
    :host(:disabled) .rail {
        background: color-mix(in srgb, var(--_rail-background) 55%, var(--_surface-page));
    }

    :host([disabled]) .fill,
    :host(:disabled) .fill {
        background: color-mix(in srgb, var(--_selection-fill) 55%, var(--_surface-page));
    }

    :host([disabled]) .thumb,
    :host(:disabled) .thumb {
        background: color-mix(in srgb, var(--_surface-page) 72%, var(--_surface-subtle));
        box-shadow: var(--_shadow-control);
    }

    :host([invalid]) .rail {
        outline: 1px solid var(--_danger-border);
        outline-offset: -1px;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .rail {
            forced-color-adjust: none;
            background: ButtonText;
        }

        .fill {
            background: Highlight;
        }

        .thumb {
            background: HighlightText;
            border: 1px solid Highlight;
            box-shadow: none;
        }

        :host([disabled]) .rail,
        :host(:disabled) .rail {
            background: GrayText;
        }

        :host([disabled]) .fill,
        :host(:disabled) .fill {
            background: GrayText;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            border-color: GrayText;
            background: Canvas;
        }
    }
`,_v=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <label id="${t=>t.labelId}" class="label" part="label" for="${t=>t.inputStartId}">${t=>t.label}</label>
            `)}
        <span id="${t=>t.labelStartId}" hidden>${t=>t.labelStart}</span>
        <span id="${t=>t.labelEndId}" hidden>${t=>t.labelEnd}</span>
        <div class="control-shell" part="control-shell" style="${t=>t.controlStyle}">
            <input
                id="${t=>t.inputStartId}"
                class="input input-start"
                part="input-start"
                type="range"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.step}"
                name="${t=>t.name}"
                :value="${t=>t.value}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-labelledby="${t=>t.thumbLabelledBy("start")}"
                aria-valuemin="${t=>t.min}"
                aria-valuemax="${t=>t.valueEnd}"
                aria-valuenow="${t=>t.valueStart}"
                aria-describedby="${t=>t.describedByIds}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                aria-orientation="${t=>t.orientation}"
                @pointerdown="${(t,e)=>t.handlePointerDown(e.event,"start")}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
            <input
                id="${t=>t.inputEndId}"
                class="input input-end"
                part="input-end"
                type="range"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.step}"
                name="${t=>t.name}"
                :value="${t=>t.valueEnd}"
                ?disabled="${t=>t.effectiveDisabled}"
                aria-labelledby="${t=>t.thumbLabelledBy("end")}"
                aria-valuemin="${t=>t.valueStart}"
                aria-valuemax="${t=>t.max}"
                aria-valuenow="${t=>t.valueEnd}"
                aria-describedby="${t=>t.describedByIds}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                aria-orientation="${t=>t.orientation}"
                @pointerdown="${(t,e)=>t.handlePointerDown(e.event,"end")}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
            <div class="visual" part="visual" aria-hidden="true">
                <div class="ticks" part="ticks" style="${t=>t.tickStyle}"></div>
                <div class="rail" part="rail">
                    <div class="fill" part="fill"></div>
                </div>
                <div class="thumb thumb-start" part="thumb-start"></div>
                <div class="thumb thumb-end" part="thumb-end"></div>
            </div>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" id="${t=>t.supportingTextId}" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.validationMessageText,u`
                <p class="error" id="${t=>t.errorTextId}" part="error-message">${t=>t.validationMessageText}</p>
            `)}
    </div>
`,ie=class extends f{static{this.formAssociated=!0}#e;#t;#i;#r;#n;constructor(){super(),this.#e=this.attachInternals(),Zt+=1,this.inputStartId=`violet-range-slider-${Zt}-start`,this.inputEndId=`violet-range-slider-${Zt}-end`,this.supportingTextId=`violet-range-slider-${Zt}-supporting`,this.errorTextId=`violet-range-slider-${Zt}-error`,this.labelId=`violet-range-slider-${Zt}-label`,this.labelStartId=`violet-range-slider-${Zt}-label-start`,this.labelEndId=`violet-range-slider-${Zt}-label-end`,this.#t="",this.#i="",this.#r=null,this.#n=null,this.label="",this.supportingText="",this.errorText="",this.valueStart="25",this.valueEnd="75",this.min="0",this.max="100",this.step="1",this.name="",this.labelStart="Minimum",this.labelEnd="Maximum",this.required=!1,this.disabled=!1,this.invalid=!1,this.showTicks=!1,this.orientation="horizontal"}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}connectedCallback(){super.connectedCallback(),this.#t=this.getAttribute("value-start")??this.valueStart,this.#i=this.getAttribute("value-end")??this.valueEnd,this.#l(),this.#o(),this.#a()}formResetCallback(){this.valueStart=this.#t||this.min||"0",this.valueEnd=this.#i||this.max||"100",this.#o(),this.#a()}valueStartChanged(){this.$fastController.isConnected&&(this.#o(),this.#a())}valueEndChanged(){this.$fastController.isConnected&&(this.#o(),this.#a())}minChanged(){this.$fastController.isConnected&&(this.#o(),this.#a())}maxChanged(){this.$fastController.isConnected&&(this.#o(),this.#a())}stepChanged(){this.$fastController.isConnected&&this.#o()}disabledChanged(){this.$fastController.isConnected&&(this.#l(),this.#a())}invalidChanged(){this.$fastController.isConnected&&(this.#l(),this.#a())}orientationChanged(){this.$fastController.isConnected&&this.#l()}get validationMessageText(){return this.invalid?this.errorText||"Please choose a valid range.":""}thumbLabelledBy(e){let i=e==="start"?this.labelStartId:this.labelEndId;return this.label?`${this.labelId} ${i}`:i}get describedByIds(){return[this.supportingText?this.supportingTextId:"",this.validationMessageText?this.errorTextId:""].filter(Boolean).join(" ")}get value(){return this.valueStart}get controlStyle(){return`--_start-percent: ${this.startPercent}; --_end-percent: ${this.endPercent}; --_mid-percent: ${this.midPercent};`}get tickStyle(){let e=this.minAsNumber,i=this.maxAsNumber,r=this.stepAsNumber,o=i-e;if(o<=0||r<=0)return"";let s=Math.round(o/r);if(s<2||s>50)return"";let n=[];for(let l=0;l<=s;l++){let d=l/s*100;l===0?n.push("var(--_tick-color) 0","var(--_tick-color) 1px","transparent 1px"):l===s?n.push("transparent calc(100% - 1px)","var(--_tick-color) calc(100% - 1px)","var(--_tick-color) 100%"):n.push(`transparent calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% + 0.5px)`,`transparent calc(${d}% + 0.5px)`)}return`background-image: linear-gradient(${this.orientation==="vertical"?"to top":"to right"}, ${n.join(", ")});`}handleInput(e){this.#s(e,"input")}handleCommit(e){this.#s(e,"change")}#s(e,i){let r=e.currentTarget;if(!r)return;let o=r.value,s=Number.parseFloat(o);if(r.classList.contains("input-start")){let a=this.valueEndAsNumber;s>a?(this.valueStart=String(a),r.value=String(a)):this.valueStart=o}else{let a=this.valueStartAsNumber;s<a?(this.valueEnd=String(a),r.value=String(a)):this.valueEnd=o}this.$emit(i,{valueStart:this.valueStart,valueEnd:this.valueEnd})}handlePointerDown(e,i){if(this.effectiveDisabled||!this.#h(e))return;e.preventDefault(),this.#r=i,this.#n=e.pointerId,(i==="start"?this.#p:this.#f)?.focus({preventScroll:!0}),this.#k(),this.ownerDocument.addEventListener("pointermove",this.#b),this.ownerDocument.addEventListener("pointerup",this.#y),this.ownerDocument.addEventListener("pointercancel",this.#y),this.#m(e,"input")}disconnectedCallback(){this.#k(),super.disconnectedCallback()}#o(){this.valueStart=this.#d(this.valueStart),this.valueEnd=this.#d(this.valueEnd);let e=Number.parseFloat(this.valueStart),i=Number.parseFloat(this.valueEnd);Number.isFinite(e)&&Number.isFinite(i)&&e>i&&(this.valueStart=this.valueEnd);let r=this.#p;r&&r.value!==this.valueStart&&(r.value=this.valueStart);let o=this.#f;o&&o.value!==this.valueEnd&&(o.value=this.valueEnd)}#a(){if(this.effectiveDisabled){this.#e.setFormValue(null),this.#e.setValidity({});return}let e=new FormData,i=this.name||"range";if(e.append(`${i}-start`,this.valueStart),e.append(`${i}-end`,this.valueEnd),this.#e.setFormValue(e),this.invalid){this.#e.setValidity({customError:!0},this.validationMessageText);return}this.#e.setValidity({})}#l(){this.#c("disabled",this.disabled),this.#c("invalid",this.invalid);let e=this.orientation==="vertical"?"vertical":"horizontal";this.getAttribute("orientation")!==e&&this.setAttribute("orientation",e)}#c(e,i){this.hasAttribute(e)!==i&&this.toggleAttribute(e,i)}#d(e){let i=this.minAsNumber,r=this.maxAsNumber,o=this.stepAsNumber,s=Number.parseFloat(e),n=Number.isFinite(s)?s:i,a=Math.min(r,Math.max(i,n));if(!Number.isFinite(o)||o<=0)return String(a);let l=Math.round((a-i)/o)*o+i,d=this.#u(o);return String(Number(l.toFixed(d)))}#u(e){let[,i=""]=String(e).split(".");return i.length}#h(e){return e.pointerType!=="mouse"||e.button===0}get#p(){return this.shadowRoot?.querySelector(".input-start")??null}get#f(){return this.shadowRoot?.querySelector(".input-end")??null}#m(e,i){let r=this.#r;if(!r)return;let o=r==="start"?this.#p:this.#f;if(!o)return;let s=this.#v(e,o);if(s!==null){if(r==="start"){let n=this.valueEndAsNumber,l=Number.parseFloat(s)>n?String(n):s;this.valueStart!==l&&(this.valueStart=l),o.value!==this.valueStart&&(o.value=this.valueStart)}else{let n=this.valueStartAsNumber,l=Number.parseFloat(s)<n?String(n):s;this.valueEnd!==l&&(this.valueEnd=l),o.value!==this.valueEnd&&(o.value=this.valueEnd)}i==="input"?this.$emit("input",{valueStart:this.valueStart,valueEnd:this.valueEnd}):this.$emit("change",{valueStart:this.valueStart,valueEnd:this.valueEnd})}}#v(e,i){let r=i.getBoundingClientRect(),o=this.minAsNumber,s=this.maxAsNumber;if(r.width<=0||r.height<=0||s<=o)return null;let n=this.orientation==="vertical"?1-(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width,a=Math.min(1,Math.max(0,n)),l=o+a*(s-o);return this.#d(String(l))}#b=e=>{e.pointerId===this.#n&&(e.preventDefault(),this.#m(e,"input"))};#y=e=>{e.pointerId===this.#n&&(e.preventDefault(),this.#m(e,"change"),this.#r=null,this.#n=null,this.#k())};#k(){this.ownerDocument.removeEventListener("pointermove",this.#b),this.ownerDocument.removeEventListener("pointerup",this.#y),this.ownerDocument.removeEventListener("pointercancel",this.#y)}get minAsNumber(){let e=Number.parseFloat(this.min);return Number.isFinite(e)?e:0}get maxAsNumber(){let e=Number.parseFloat(this.max);return Number.isFinite(e)?e:100}get stepAsNumber(){let e=Number.parseFloat(this.step);return Number.isFinite(e)?e:1}get valueStartAsNumber(){let e=Number.parseFloat(this.valueStart);return Number.isFinite(e)?e:this.minAsNumber}get valueEndAsNumber(){let e=Number.parseFloat(this.valueEnd);return Number.isFinite(e)?e:this.maxAsNumber}get startPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"0%";let r=(this.valueStartAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,r))*100}%`}get endPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"100%";let r=(this.valueEndAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,r))*100}%`}get midPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"50%";let r=(this.valueStartAsNumber-e)/(i-e),o=(this.valueEndAsNumber-e)/(i-e),s=(r+o)/2;return`${Math.min(1,Math.max(0,s))*100}%`}};c(ie.prototype,"label");c({attribute:"supporting-text"})(ie.prototype,"supportingText");c({attribute:"error-text"})(ie.prototype,"errorText");c({attribute:"value-start"})(ie.prototype,"valueStart");c({attribute:"value-end"})(ie.prototype,"valueEnd");c(ie.prototype,"min");c(ie.prototype,"max");c(ie.prototype,"step");c(ie.prototype,"name");c({attribute:"label-start"})(ie.prototype,"labelStart");c({attribute:"label-end"})(ie.prototype,"labelEnd");c({mode:"boolean"})(ie.prototype,"required");c({mode:"boolean"})(ie.prototype,"disabled");q(ie.prototype);c({mode:"boolean"})(ie.prototype,"invalid");c({attribute:"show-ticks",mode:"boolean"})(ie.prototype,"showTicks");c(ie.prototype,"orientation");customElements.get("violet-range-slider")||await f.define(ie,{name:"violet-range-slider",template:_v,styles:wv});var bu=0,kv=v`
    ${F}

    :host {
        display: grid;

        --_selection-fill: color-mix(in srgb, var(--color-control-selected-foreground, #244635) 50%, var(--color-control-selected-background, #ddeadf));
        --_rail-background: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_radius-full: var(--radius-round, 9999px);
        --_thumb-size: calc(var(--_target-size) * 0.625);
        --_track-size: calc(var(--_target-size) * 0.125);
        --_control-block-size: var(--_target-size);
        --_vertical-track-size: calc(var(--_target-size) * 4);
        --_tick-size: 6px;
        --_tick-color: var(--_rail-background);
        --_slider-percent: 50%;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        min-inline-size: 0;
        block-size: var(--_control-block-size);
        border-radius: var(--_radius-md);
    }

    :host([orientation="vertical"]) .control-shell {
        justify-items: center;
        inline-size: var(--_target-size);
        block-size: var(--_vertical-track-size);
    }

    .input {
        position: absolute;
        inset: 0;
        margin: 0;
        inline-size: 100%;
        block-size: 100%;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 0;
        opacity: 0;
        cursor: pointer;
        touch-action: none;
    }

    :host([orientation="vertical"]) .input {
        writing-mode: vertical-lr;
        direction: rtl;
    }

    .visual {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        block-size: 100%;
        pointer-events: none;
    }

    :host([orientation="vertical"]) .visual {
        justify-items: center;
    }

    .rail {
        position: relative;
        inline-size: 100%;
        block-size: var(--_track-size);
        border-radius: var(--_radius-full);
        background: var(--_rail-background);
        overflow: hidden;
    }

    :host([orientation="vertical"]) .rail {
        inline-size: var(--_track-size);
        block-size: 100%;
    }

    .fill {
        display: none;
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: 0;
        inline-size: var(--_slider-percent);
        block-size: 100%;
        border-radius: inherit;
        background: var(--_selection-fill);
    }

    :host([show-fill]) .fill {
        display: block;
    }

    :host([orientation="vertical"]) .fill {
        inset-block-start: auto;
        inset-block-end: 0;
        inline-size: 100%;
        block-size: var(--_slider-percent);
    }

    .ticks {
        display: none;
        position: absolute;
        inset-inline: 0;
        block-size: var(--_tick-size);
        inset-block-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        pointer-events: none;
    }

    :host([show-ticks]) .ticks {
        display: block;
    }

    :host([orientation="vertical"]) .ticks {
        inset-block: 0;
        inset-inline: auto;
        inset-inline-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        inline-size: var(--_tick-size);
        block-size: auto;
    }

    .thumb {
        position: absolute;
        inset-inline-start: var(--_slider-percent);
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        border-radius: var(--_radius-full);
        background: var(--_surface-page);
        border: 1px solid var(--_border-subtle);
        box-shadow: var(--_shadow-floating);
        transform: translate(-50%, -50%);
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    :host([orientation="vertical"]) .thumb {
        inset-inline-start: 50%;
        inset-block-start: auto;
        inset-block-end: var(--_slider-percent);
        transform: translate(-50%, 50%);
    }

    .control-shell:focus-within .thumb {
        box-shadow:
            var(--_shadow-floating),
            0 0 0 2px var(--_focus-ring);
    }

    :host([disabled]) .input,
    :host(:disabled) .input {
        cursor: not-allowed;
    }

    :host([disabled]) .control-shell,
    :host(:disabled) .control-shell {
        cursor: not-allowed;
    }

    :host([disabled]) .visual,
    :host(:disabled) .visual {
        opacity: 0.6;
    }

    :host([disabled]) .rail,
    :host(:disabled) .rail {
        background: color-mix(in srgb, var(--_rail-background) 55%, var(--_surface-page));
    }

    :host([disabled]) .fill,
    :host(:disabled) .fill {
        background: color-mix(in srgb, var(--_selection-fill) 55%, var(--_surface-page));
    }

    :host([disabled]) .thumb,
    :host(:disabled) .thumb {
        background: color-mix(in srgb, var(--_surface-page) 72%, var(--_surface-subtle));
        box-shadow: var(--_shadow-control);
    }

    :host([invalid]) .rail {
        outline: 1px solid var(--_danger-border);
        outline-offset: -1px;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .rail {
            forced-color-adjust: none;
            background: ButtonText;
        }

        .fill {
            background: Highlight;
        }

        .thumb {
            background: HighlightText;
            border: 1px solid Highlight;
            box-shadow: none;
        }

        :host([disabled]) .rail,
        :host(:disabled) .rail {
            background: GrayText;
        }

        :host([disabled]) .fill,
        :host(:disabled) .fill {
            background: GrayText;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            border-color: GrayText;
            background: Canvas;
        }
    }
`,Cv=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`
                <label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>
            `)}
        <div class="control-shell" part="control-shell" style="${t=>t.controlStyle}">
            <input
                id="${t=>t.inputId}"
                class="input"
                part="input"
                type="range"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.step}"
                :value="${t=>t.value}"
                name="${t=>t.name}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-label="${t=>t.label||t.getAttribute("aria-label")||""}"
                aria-describedby="${t=>t.describedByIds}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                aria-orientation="${t=>t.orientation}"
                aria-valuetext="${t=>t.valueText||null}"
                @pointerdown="${(t,e)=>t.handlePointerDown(e.event)}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
            <div class="visual" part="visual" aria-hidden="true">
                <div class="ticks" part="ticks" style="${t=>t.tickStyle}"></div>
                <div class="rail" part="rail">
                    <div class="fill" part="fill"></div>
                </div>
                <div class="thumb" part="thumb"></div>
            </div>
        </div>
        ${b(t=>!!t.supportingText,u`
                <p class="supporting" id="${t=>t.supportingTextId}" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${b(t=>!!t.validationMessageText,u`
                <p class="error" id="${t=>t.errorTextId}" part="error-message">${t=>t.validationMessageText}</p>
            `)}
    </div>
`,ne=class extends f{static{this.formAssociated=!0}#e;#t;#i;constructor(){super(),this.#e=this.attachInternals(),bu+=1,this.inputId=`violet-slider-${bu}`,this.supportingTextId=`${this.inputId}-supporting`,this.errorTextId=`${this.inputId}-error`,this.#t="",this.#i=null,this.label="",this.supportingText="",this.errorText="",this.valueText="",this.value="50",this.min="0",this.max="100",this.step="1",this.name="",this.required=!1,this.orientation="horizontal",this.disabled=!1,this.invalid=!1,this.showFill=!1,this.showTicks=!1}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}connectedCallback(){super.connectedCallback(),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.#t=this.getAttribute("value")??this.value,this.#s(),this.#r(),this.#n()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t||this.min||"0",this.#r(),this.#n()}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name)}valueChanged(){this.$fastController.isConnected&&(this.#r(),this.#n())}minChanged(){this.$fastController.isConnected&&(this.#r(),this.#n())}maxChanged(){this.$fastController.isConnected&&(this.#r(),this.#n())}stepChanged(){this.$fastController.isConnected&&this.#r()}disabledChanged(){this.$fastController.isConnected&&(this.#s(),this.#n())}invalidChanged(){this.$fastController.isConnected&&(this.#s(),this.#n())}orientationChanged(){this.$fastController.isConnected&&this.#s()}get validationMessageText(){return this.invalid?this.errorText||"Please choose a valid value.":""}get describedByIds(){return[this.supportingText?this.supportingTextId:"",this.validationMessageText?this.errorTextId:""].filter(Boolean).join(" ")}get controlStyle(){return`--_slider-percent: ${this.percent};`}get tickStyle(){let e=this.minAsNumber,i=this.maxAsNumber,r=this.stepAsNumber,o=i-e;if(o<=0||r<=0)return"";let s=Math.round(o/r);if(s<2||s>50)return"";let n=[];for(let l=0;l<=s;l++){let d=l/s*100;l===0?n.push("var(--_tick-color) 0","var(--_tick-color) 1px","transparent 1px"):l===s?n.push("transparent calc(100% - 1px)","var(--_tick-color) calc(100% - 1px)","var(--_tick-color) 100%"):n.push(`transparent calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% + 0.5px)`,`transparent calc(${d}% + 0.5px)`)}return`background-image: linear-gradient(${this.orientation==="vertical"?"to top":"to right"}, ${n.join(", ")});`}handleInput(e){let i=e.currentTarget;this.value=i?.value??this.value,this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??this.value,this.$emit("change",{value:this.value})}handlePointerDown(e){if(this.effectiveDisabled||!this.#c(e))return;let i=this.#d;i&&(e.preventDefault(),this.#i=e.pointerId,i.focus({preventScroll:!0}),this.#m(),this.ownerDocument.addEventListener("pointermove",this.#p),this.ownerDocument.addEventListener("pointerup",this.#f),this.ownerDocument.addEventListener("pointercancel",this.#f),this.#u(e,"input"))}disconnectedCallback(){this.#m(),super.disconnectedCallback()}#r(){this.value=this.#a(this.value);let e=this.#d;e&&e.value!==this.value&&(e.value=this.value)}#n(){if(this.effectiveDisabled){this.#e.setFormValue(null),this.#e.setValidity({});return}if(this.#e.setFormValue(this.value),this.invalid){this.#e.setValidity({customError:!0},this.validationMessageText);return}this.#e.setValidity({})}#s(){this.#o("disabled",this.disabled),this.#o("invalid",this.invalid);let e=this.orientation==="vertical"?"vertical":"horizontal";this.getAttribute("orientation")!==e&&this.setAttribute("orientation",e)}#o(e,i){this.hasAttribute(e)!==i&&this.toggleAttribute(e,i)}#a(e){let i=this.minAsNumber,r=this.maxAsNumber,o=this.stepAsNumber,s=Number.parseFloat(e),n=Number.isFinite(s)?s:i,a=Math.min(r,Math.max(i,n));if(!Number.isFinite(o)||o<=0)return String(a);let l=Math.round((a-i)/o)*o+i,d=this.#l(o);return String(Number(l.toFixed(d)))}#l(e){let[,i=""]=String(e).split(".");return i.length}#c(e){return e.pointerType!=="mouse"||e.button===0}get#d(){return this.shadowRoot?.querySelector(".input")??null}#u(e,i){let r=this.#d;if(!r)return;let o=this.#h(e,r);o!==null&&(this.value!==o&&(this.value=o),r.value!==this.value&&(r.value=this.value),i==="input"?this.$emit("input",{value:this.value}):this.$emit("change",{value:this.value}))}#h(e,i){let r=i.getBoundingClientRect(),o=this.minAsNumber,s=this.maxAsNumber;if(r.width<=0||r.height<=0||s<=o)return null;let n=this.orientation==="vertical"?1-(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width,a=Math.min(1,Math.max(0,n)),l=o+a*(s-o);return this.#a(String(l))}#p=e=>{e.pointerId===this.#i&&(e.preventDefault(),this.#u(e,"input"))};#f=e=>{e.pointerId===this.#i&&(e.preventDefault(),this.#u(e,"change"),this.#i=null,this.#m())};#m(){this.ownerDocument.removeEventListener("pointermove",this.#p),this.ownerDocument.removeEventListener("pointerup",this.#f),this.ownerDocument.removeEventListener("pointercancel",this.#f)}get minAsNumber(){let e=Number.parseFloat(this.min);return Number.isFinite(e)?e:0}get maxAsNumber(){let e=Number.parseFloat(this.max);return Number.isFinite(e)?e:100}get stepAsNumber(){let e=Number.parseFloat(this.step);return Number.isFinite(e)?e:1}get valueAsNumber(){let e=Number.parseFloat(this.value);return Number.isFinite(e)?e:this.minAsNumber}get percent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"0%";let r=(this.valueAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,r))*100}%`}};c(ne.prototype,"label");c({attribute:"supporting-text"})(ne.prototype,"supportingText");c({attribute:"error-text"})(ne.prototype,"errorText");c({attribute:"value-text"})(ne.prototype,"valueText");c(ne.prototype,"value");c(ne.prototype,"min");c(ne.prototype,"max");c(ne.prototype,"step");c(ne.prototype,"name");c({mode:"boolean"})(ne.prototype,"required");c(ne.prototype,"orientation");c({mode:"boolean"})(ne.prototype,"disabled");q(ne.prototype);c({mode:"boolean"})(ne.prototype,"invalid");c({attribute:"show-fill",mode:"boolean"})(ne.prototype,"showFill");c({attribute:"show-ticks",mode:"boolean"})(ne.prototype,"showTicks");customElements.get("violet-slider")||await f.define(ne,{name:"violet-slider",template:Cv,styles:kv});var zv=v`
    ${E}

    :host {
        display: block;
        --_skeleton-surface: color-mix(in srgb, var(--_surface-subtle) 72%, var(--_surface-card));
        --_skeleton-highlight: color-mix(in srgb, white 68%, var(--_surface-card));
        --_skeleton-radius: var(--_radius-md);
        --_skeleton-block-size: 0.875rem;
        --_skeleton-circle-size: 2rem;
    }

    :host([size="sm"]) {
        --_skeleton-block-size: 0.75rem;
        --_skeleton-circle-size: 1.5rem;
    }

    :host([size="md"]) {
        --_skeleton-block-size: 0.875rem;
        --_skeleton-circle-size: 2rem;
    }

    :host([size="lg"]) {
        --_skeleton-block-size: 1rem;
        --_skeleton-circle-size: 2.75rem;
    }

    .root {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .bar {
        position: relative;
        overflow: hidden;
        inline-size: 100%;
        block-size: var(--_skeleton-block-size);
        border-radius: var(--_skeleton-radius);
        background: var(--_skeleton-surface);
    }

    .bar.circle {
        inline-size: var(--_skeleton-circle-size);
        block-size: var(--_skeleton-circle-size);
        border-radius: var(--_radius-round);
    }

    .bar::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
            90deg,
            transparent 0%,
            color-mix(in srgb, var(--_skeleton-highlight) 30%, transparent) 40%,
            color-mix(in srgb, var(--_skeleton-highlight) 75%, transparent) 50%,
            color-mix(in srgb, var(--_skeleton-highlight) 30%, transparent) 60%,
            transparent 100%
        );
        animation: shimmer 1.6s linear infinite;
    }

    :host(:not([animated])) .bar::after {
        display: none;
    }

    @keyframes shimmer {
        to {
            transform: translateX(100%);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .bar::after {
            animation-duration: 2.8s;
        }
    }

    @media (forced-colors: active) {
        .bar {
            forced-color-adjust: none;
            background: GrayText;
        }

        .bar::after {
            display: none;
        }
    }
`,Sv=t=>{let e=Math.max(1,Number(t.lines)||1);return Array.from({length:e},(i,r)=>e===1?"100%":r===e-1?"68%":r%3===1?"84%":"100%")},$v=u`
    <div class="root" part="root" aria-hidden="true">
        ${L(t=>Sv(t),u`
                <div
                    class="${(t,e)=>`bar${e.parent.shape==="circle"?" circle":""}`}"
                    part="bar"
                    style="inline-size:${t=>t};"
                ></div>
            `)}
    </div>
`,fi=class extends f{constructor(){super(),this.shape="rect",this.size="md",this.lines="1",this.animated=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("aria-hidden","true")}};c(fi.prototype,"shape");c(fi.prototype,"size");c(fi.prototype,"lines");c({mode:"boolean"})(fi.prototype,"animated");customElements.get("violet-skeleton")||await f.define(fi,{name:"violet-skeleton",template:$v,styles:zv});var xu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},yu=0,Ev=v`
    ${F}

    :host {
        display: inline-grid;

        --_selection-background: var(--color-control-selected-background, #ddeadf);
        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_selection-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_thumb-resting: var(--color-text-muted, #616775);
        --_radius-full: var(--radius-round, 9999px);
        --_size-font-md: var(--size-font-md, 14px);
        --_track-block-size: clamp(20px, calc(var(--_target-size) - 10px), 24px);
        --_track-inline-size: calc(var(--_track-block-size) * 2);
        --_track-border-width: 1px;
        --_track-padding: 2px;
        --_thumb-size: clamp(16px, calc(var(--_track-block-size) - 4px), 20px);
        --_thumb-offset: calc(
            var(--_track-inline-size) -
            var(--_thumb-size) -
            (var(--_track-padding) * 2) -
            (var(--_track-border-width) * 2)
        );
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
    }

    :host([inline]) {
        --_target-size: var(--violet-switch-inline-target-size, var(--_target-size-compact));
        --_space-inline-sm: var(--violet-switch-inline-gap, 4px);
    }

    .root {
        display: inline-grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: calc(var(--_space-inline-sm) * 2);
        align-items: start;
        min-block-size: var(--_target-size);
        cursor: pointer;
    }

    :host([inline]) .root {
        grid-template-columns: auto;
        gap: 0;
        align-items: center;
        min-block-size: auto;
    }

    .control-shell {
        position: relative;
        display: inline-grid;
        min-block-size: var(--_target-size);
        align-items: center;
    }

    :host([inline]) .control-shell {
        min-block-size: auto;
        line-height: 0;
    }

    /*
     * The native input is transparent but fills the whole control shell, so it is
     * the element a pointer (or a role-based click) lands on: the decorative track
     * does not take pointer events, and a clipped box would have no hit area. It
     * has no z-index, so it never competes with page content outside the control.
     */
    .input {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        margin: 0;
        padding: 0;
        appearance: none;
        opacity: 0;
        border: 0;
        cursor: inherit;
    }

    .track {
        box-sizing: border-box;
        position: relative;
        display: inline-block;
        pointer-events: none;
        inline-size: var(--_track-inline-size);
        block-size: var(--_track-block-size);
        border: var(--_track-border-width) solid var(--_border-strong);
        border-radius: var(--_radius-full);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .thumb {
        position: absolute;
        inset-inline-start: var(--_track-padding);
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        border-radius: var(--_radius-full);
        background: var(--_thumb-resting);
        transform: translate(0, -50%);
        transform-origin: center;
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    .input:checked + .track {
        background: var(--_selection-background);
        border-color: var(--_selection-border);
    }

    .input:checked + .track .thumb {
        transform: translate(var(--_thumb-offset), -50%);
        background: var(--_selection-text);
    }

    .input:focus-visible + .track {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    :host([invalid]) .track {
        border-color: var(--_danger-border);
    }

    :host([disabled]) .root,
    :host(:disabled) .root {
        cursor: not-allowed;
    }

    /* Supporting text often says why the control is unavailable, so it stays readable. */
    :host([disabled]) :is(.control-shell, .label),
    :host(:disabled) :is(.control-shell, .label) {
        opacity: 0.6;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_target-size);
        align-content: center;
        min-inline-size: 0;
    }

    .content[hidden] {
        display: none;
    }

    :host([inline]) .content {
        min-block-size: auto;
        align-content: center;
    }

    .label {
        color: var(--color-text-primary, #18181b);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
    }

    .supporting {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    @media (forced-colors: active) {
        .track {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }

        .thumb {
            background: ButtonText;
        }

        .input:checked + .track {
            border-color: Highlight;
            background: Highlight;
        }

        .input:checked + .track .thumb {
            background: HighlightText;
        }

        :host([disabled]) .track,
        :host(:disabled) .track {
            border-color: GrayText;
            background: Canvas;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            background: GrayText;
        }
    }
`,Tv=u`
    <div class="root" part="root">
        <span class="control-shell">
            <input
                class="input"
                part="input"
                id="${t=>t.controlId}"
                type="checkbox"
                role="switch"
                :checked="${t=>t.checked}"
                name="${t=>t.name}"
                value="${t=>t.value}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @change="${(t,e)=>t.handleChange(e.event)}"
            />
            <span class="track" part="control" aria-hidden="true" @click="${t=>t.handleTrackClick()}">
                <span class="thumb" part="thumb" aria-hidden="true"></span>
            </span>
        </span>
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting}">
            <label class="label" part="label" for="${t=>t.controlId}" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                id="${t=>t.supportingTextId}"
                part="supporting-text"
                ?hidden="${t=>!t.hasSupporting}"
            >
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
        </span>
    </div>
`,Fe=class extends f{static{this.formAssociated=!0}#e;#t;constructor(){super(),this.#e=this.attachInternals();let e=yu;yu+=1,this.controlId=`${this.localName||"violet-switch"}-control-${e}`,this.supportingTextId=`${this.localName||"violet-switch"}-supporting-${e}`,this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.name="",this.value="on",this.required=!1,this.#t=!1}connectedCallback(){super.connectedCallback(),this.#t=this.hasAttribute("checked")?this.getAttribute("checked")!=="false":this.checked,this.#i(),this.#r(),this.#s(),this.#o()}handleChange(e){let i=e.currentTarget;this.checked=i?.checked??!1,this.$emit("change",{checked:this.checked})}handleTrackClick(){this.shadowRoot?.querySelector('input[type="checkbox"]')?.click()}handleDefaultSlotChange(){this.#i(),this.#s()}handleSupportingSlotChange(){this.#r(),this.#s()}formStateRestoreCallback(e){(e==="checked"||e==="unchecked")&&(this.checked=e==="checked")}formResetCallback(){this.checked=this.#t}get explicitAriaLabel(){return this.getAttribute("aria-label")?.trim()||null}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}checkedChanged(){this.#s(),this.#o()}disabledChanged(){this.#s(),this.#o()}invalidChanged(){this.#s(),this.#o()}requiredChanged(){this.#s(),this.#o()}valueChanged(){this.#s(),this.#o()}nameChanged(){this.#s()}#i(){this.hasLabel=this.#n().length>0}#r(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#n(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#s(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(!e)return;e.checked=this.checked,e.disabled=this.effectiveDisabled,e.required=this.required,e.name=this.name,e.value=this.value,e.setAttribute("role","switch"),e.setAttribute("aria-invalid",this.invalid?"true":"false");let i=this.explicitAriaLabel;i?e.setAttribute("aria-label",i):e.removeAttribute("aria-label"),this.hasSupporting?e.setAttribute("aria-describedby",this.supportingTextId):e.removeAttribute("aria-describedby")}#o(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(!this.effectiveDisabled&&this.checked?this.value:null,this.checked?"checked":"unchecked"),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},"Please correct this field.",e??void 0);return}if(this.required&&!this.checked){this.#e.setValidity({valueMissing:!0},"Please turn this setting on.",e??void 0);return}this.#e.setValidity({})}};xu([m],Fe.prototype,"hasSupporting",void 0);xu([m],Fe.prototype,"hasLabel",void 0);c({mode:"boolean"})(Fe.prototype,"checked");c({mode:"boolean"})(Fe.prototype,"disabled");q(Fe.prototype);c({mode:"boolean"})(Fe.prototype,"inline");c({mode:"boolean"})(Fe.prototype,"invalid");c(Fe.prototype,"name");c(Fe.prototype,"value");c({mode:"boolean"})(Fe.prototype,"required");customElements.get("violet-switch")||await f.define(Fe,{name:"violet-switch",template:Tv,styles:Ev,shadowOptions:{delegatesFocus:!0}});var Iv=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Av=v`
    ${E}

    :host {
        position: fixed;
        inset-inline-start: 50%;
        inset-block-end: var(--violet-snackbar-inset-block-end, var(--_space-lg));
        transform: translateX(-50%);
        z-index: var(--_layer-toast);
        inline-size: min(var(--violet-snackbar-inline-size, 32rem), calc(100vw - (var(--_space-lg) * 2)));
        max-inline-size: calc(100vw - (var(--_space-lg) * 2));
        color: var(--_text-primary);
        --_snackbar-padding-inline: var(--violet-snackbar-padding-inline, var(--_space-md));
        --_snackbar-padding-block: var(--violet-snackbar-padding-block, var(--_space-sm));
        --_snackbar-gap: var(--violet-snackbar-gap, var(--_space-sm));
        --_snackbar-radius: var(--violet-snackbar-radius, calc(var(--_radius-lg) * 1.33));
        --_snackbar-surface: var(--violet-snackbar-surface, var(--_surface-floating));
        --_snackbar-border: var(--violet-snackbar-border, var(--_border-subtle));
        --_snackbar-shadow: var(--violet-snackbar-shadow, var(--_shadow-floating));
        --_snackbar-emphasis: var(--violet-snackbar-emphasis, var(--_text-primary));
        --_snackbar-action: var(--violet-snackbar-action, var(--_text-primary));
        --_snackbar-body-size: var(--violet-snackbar-body-size, var(--_body-size));
        --_snackbar-body-line: var(--violet-snackbar-body-line, var(--_body-line));
    }

    :host(:not([open])) {
        display: none;
    }

    :host([tone="info"]) {
        --_snackbar-surface: var(--_surface-card);
        --_snackbar-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
    }

    :host([tone="success"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-success-background, #E3F1E7) 78%, var(--_surface-card));
        --_snackbar-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_snackbar-emphasis: var(--color-state-success-text, #166534);
        --_snackbar-action: var(--color-state-success-text, #166534);
    }

    :host([tone="warning"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-warning-background, #FDEBCC) 82%, var(--_surface-card));
        --_snackbar-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_snackbar-emphasis: var(--color-state-warning-text, #92400E);
        --_snackbar-action: var(--color-state-warning-text, #92400E);
    }

    :host([tone="danger"]) {
        --_snackbar-surface: color-mix(in srgb, var(--color-state-danger-background, #FBE2E2) 82%, var(--_surface-card));
        --_snackbar-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_snackbar-emphasis: var(--color-state-danger-text, #B42318);
        --_snackbar-action: var(--color-state-danger-text, #B42318);
    }

    .frame {
        --violet-card-radius: var(--_snackbar-radius);
        --violet-card-padding: 0;
        --violet-card-background: var(--_snackbar-surface);
        --violet-card-border-color: var(--_snackbar-border);
        --violet-card-shadow: var(--_snackbar-shadow);
    }

    .layout {
        display: flex;
        align-items: center;
        gap: var(--_snackbar-gap);
        min-block-size: var(--_target-size-natural);
        padding: var(--_snackbar-padding-block) var(--_snackbar-padding-inline);
    }

    .message {
        display: block;
        flex: 1 1 auto;
        min-inline-size: 0;
        font-size: var(--_snackbar-body-size);
        line-height: var(--_snackbar-body-line);
        color: var(--_snackbar-emphasis);
    }

    .message-copy {
        display: block;
    }

    .message slot::slotted(*) {
        margin: 0;
    }

    .action {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
    }

    .action[hidden] {
        display: none;
    }

    .action ::slotted(violet-button) {
        color: var(--_snackbar-action);
        --violet-button-padding-inline: var(--_space-sm);
    }

    .dismiss {
        flex: 0 0 auto;
        color: var(--_snackbar-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (max-width: 480px) {
        :host {
            inset-inline-start: var(--_space-md);
            inset-inline-end: var(--_space-md);
            transform: none;
            inline-size: auto;
            max-inline-size: none;
        }

        .layout {
            align-items: start;
        }
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
        }
    }
`,Rv=u`
    <violet-card class="frame" part="root" appearance="outline" padding="none">
        <div class="layout" part="layout">
            <div class="message" part="message">
                <div
                    class="message-copy"
                    part="message-copy"
                    role="${t=>t.liveRegionRole||null}"
                    aria-live="${t=>t.liveRegionPoliteness||null}"
                >
                    <slot></slot>
                </div>
            </div>
            <div class="action" part="action" ?hidden="${t=>!t.hasAction}">
                <slot name="action" @slotchange="${t=>t.handleActionSlotChange()}"></slot>
            </div>
            <violet-icon-button
                class="dismiss"
                part="dismiss-button"
                appearance="transparent"
                label="Dismiss message"
                ?hidden="${t=>!t.dismissible}"
                @click="${t=>t.dismiss("dismiss-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`,Dt=class extends f{#e=null;constructor(){super(),this.hasAction=!1,this.open=!1,this.tone="default",this.announcement="polite",this.dismissible=!1,this.timeout="6000"}connectedCallback(){super.connectedCallback(),Ne(),this.handleActionSlotChange(),this.#t()}disconnectedCallback(){super.disconnectedCallback(),this.#i()}openChanged(e,i){!this.$fastController.isConnected||e===i||(this.#t(),this.$emit("open-change",{open:i}))}timeoutChanged(){this.$fastController.isConnected&&this.#t()}handleActionSlotChange(){this.hasAction=this.#r('slot[name="action"]');let e=this.shadowRoot?.querySelector(".action");e&&(e.hidden=!this.hasAction),this.$fastController.isConnected&&this.#t()}dismiss(e){this.open&&(this.#i(),this.open=!1,this.$emit("dismiss",{reason:e}))}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}#t(){this.#i();let e=Number.parseInt(this.timeout,10);!this.open||this.hasAction||this.dismissible||!Number.isFinite(e)||e<=0||(this.#e=window.setTimeout(()=>{this.dismiss("timeout")},e))}#i(){this.#e!==null&&(window.clearTimeout(this.#e),this.#e=null)}#r(e){let i=this.shadowRoot?.querySelector(e),r=i?.name;return r&&this.querySelector(`[slot="${r}"]`)?!0:(i?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0)}};Iv([m],Dt.prototype,"hasAction",void 0);c({mode:"boolean"})(Dt.prototype,"open");c(Dt.prototype,"tone");c(Dt.prototype,"announcement");c({mode:"boolean"})(Dt.prototype,"dismissible");c(Dt.prototype,"timeout");customElements.get("violet-snackbar")||await f.define(Dt,{name:"violet-snackbar",template:Rv,styles:Av,shadowOptions:{delegatesFocus:!0}});var Fv=v`
    ${F}
    ${E}

    :host {
        display: inline-flex;
        position: relative;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        min-block-size: var(--_target-size);
        min-inline-size: max-content;
        max-inline-size: 100%;
        border: 1px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--_text-secondary);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
        user-select: none;
        white-space: nowrap;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            color var(--_duration-fast) var(--_easing-standard),
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);

        --_selection-text: var(--color-control-selected-foreground, #244635);
        --_tab-border: color-mix(in srgb, var(--_border-subtle) 88%, transparent);
        --_tab-hover: color-mix(in srgb, var(--_surface-subtle) 42%, white);
        --_tab-closed-resting: color-mix(in srgb, var(--_surface-card) 86%, white);
        --_tab-indicator-thickness: 2px;
        --_tab-selected-accent-thickness: var(--_tab-indicator-thickness);
    }

    :host([hidden]) {
        display: none;
    }

    :host([aria-selected="true"]) {
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([disabled]),
    :host([aria-disabled="true"]) {
        cursor: not-allowed;
        opacity: 0.55;
    }

    :host(:focus-visible) {
        box-shadow: 0 0 0 2px var(--_focus-ring);
        z-index: 3;
    }

    .surface {
        position: relative;
        display: inline-flex;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        gap: var(--_space-inline-sm);
        min-block-size: inherit;
        min-inline-size: 0;
        max-inline-size: 100%;
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_space-inline-sm) + 2px) var(--_space-inline-sm);
    }

    .label {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .indicator {
        position: absolute;
        inset: auto;
        inline-size: 0;
        block-size: 0;
        border-radius: var(--_radius-round);
        background: var(--_selection-text);
        opacity: 0;
        pointer-events: none;
        transform: none;
        transform-origin: center;
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    :host([data-appearance="open"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover),
    :host([data-appearance="mixed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover) {
        background: var(--_tab-hover);
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([data-appearance="open"][aria-selected="true"]) .indicator {
        inset-inline: 0;
        inset-block-end: calc(var(--_space-inline-sm) * -1);
        inline-size: auto;
        block-size: var(--_tab-indicator-thickness);
        opacity: 1;
        transform: scaleX(1);
    }

    :host([data-appearance="open"]:not([aria-selected="true"])) .indicator,
    :host([data-appearance="mixed"]:not([aria-selected="true"])) .indicator {
        transform: scaleX(0.72);
    }

    :host([data-appearance="closed"]),
    :host([data-appearance="mixed"][aria-selected="true"]) {
        margin-block-end: -1px;
        border-color: var(--_tab-border);
        border-radius: calc(var(--_radius-md) + 2px) calc(var(--_radius-md) + 2px) 0 0;
    }

    :host([data-appearance="closed"]) {
        background: var(--_tab-closed-resting);
    }

    :host([data-appearance="closed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover) {
        background: color-mix(in srgb, var(--_surface-page) 90%, var(--_tab-closed-resting));
        color: var(--_text-primary, var(--color-text-primary, #18181b));
    }

    :host([data-appearance="closed"][aria-selected="true"]),
    :host([data-appearance="mixed"][aria-selected="true"]) {
        background: var(--_surface-page);
        border-block-end-width: 0;
        border-block-end-color: transparent;
        z-index: 1;
        box-shadow: none;
    }

    :host([data-appearance="closed"][aria-selected="true"]) .indicator,
    :host([data-appearance="mixed"][aria-selected="true"]) .indicator {
        inset-inline: 0;
        inset-block-start: auto;
        inset-block-end: 0;
        inline-size: auto;
        block-size: var(--_tab-selected-accent-thickness);
        opacity: 1;
        transform: none;
    }

    :host([data-orientation="vertical"]) {
        justify-content: flex-start;
        text-align: start;
        white-space: normal;
    }

    :host([data-orientation="vertical"]) .surface {
        inline-size: 100%;
        justify-content: flex-start;
        padding-inline-start: var(--_space-inline-md);
        padding-inline-end: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
    }

    :host([data-orientation="vertical"][data-appearance="open"]),
    :host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])) {
        border-radius: var(--_radius-md);
    }

    :host([data-orientation="vertical"][data-appearance="open"][aria-selected="true"]) .indicator {
        inset-inline-start: calc(var(--_space-inline-md) * -0.5);
        inset-inline-end: auto;
        inset-block: 0;
        inline-size: var(--_tab-indicator-thickness);
        block-size: auto;
        transform: scaleY(1);
    }

    :host([data-orientation="vertical"][data-appearance="open"]:not([aria-selected="true"])) .indicator,
    :host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])) .indicator {
        transform: scaleY(0.72);
    }

    :host([data-orientation="vertical"][data-appearance="closed"]),
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) {
        margin-block-end: 0;
        margin-inline-end: -1px;
        border-radius: calc(var(--_radius-md) + 2px) 0 0 calc(var(--_radius-md) + 2px);
    }

    :host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]),
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) {
        border-inline-end-width: 0;
        border-inline-end-color: transparent;
        box-shadow: none;
    }

    :host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]) .indicator,
    :host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) .indicator {
        inset-inline-start: 0;
        inset-inline-end: auto;
        inset-block: 0;
        inline-size: var(--_tab-selected-accent-thickness);
        block-size: auto;
        opacity: 1;
        transform: none;
    }
`,Dv=u`
    <div class="surface" part="root">
        <span class="label" part="label"><slot></slot></span>
        <span class="indicator" part="indicator" aria-hidden="true"></span>
    </div>
`,Qo=class extends f{#e=!1;get effectiveDisabled(){return this.disabled||this.#e}setDisabledFromTabs(e){this.#e=e}syncPresentation(e,i){this.setAttribute("data-appearance",e),this.setAttribute("data-orientation",i)}};c({mode:"boolean"})(Qo.prototype,"disabled");customElements.get("violet-tab")||await f.define(Qo,{name:"violet-tab",template:Dv,styles:Fv});var Mv=v`
    ${F}
    ${E}

    :host {
        display: block;
        color: var(--_text-primary, var(--color-text-primary, #18181b));
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
    }

    :host([hidden]) {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-md, 12px);
    }
`,Ov=u`
    <div class="content" part="root">
        <slot></slot>
    </div>
`,En=class extends f{};customElements.get("violet-tab-panel")||await f.define(En,{name:"violet-tab-panel",template:Ov,styles:Mv});var Tn=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},wu=0,Lv=v`
    ${F}
    ${E}

    :host {
        display: grid;
        gap: var(--_space-stack-sm);
        color: var(--_text-primary, var(--color-text-primary, #18181b));

        --_panel-background: var(--_surface-page);
        --_panel-border: color-mix(in srgb, var(--_border-subtle) 92%, transparent);
        --_panel-shadow: var(--_shadow-control);
        --_panel-padding: var(--_space-lg, 24px);
        --_tablist-divider: color-mix(in srgb, var(--_border-subtle) 92%, transparent);
    }

    :host([appearance="closed"]),
    :host([appearance="mixed"]) {
        gap: 0;
    }

    :host([orientation="vertical"]) {
        grid-template-columns: minmax(max-content, 16rem) minmax(0, 1fr);
        align-items: start;
        gap: var(--_space-md, 12px);
    }

    .tablist-shell {
        min-inline-size: 0;
        border-block-end: 1px solid var(--_tablist-divider);
    }

    :host([appearance="closed"]) .tablist-shell,
    :host([appearance="mixed"]) .tablist-shell {
        border-block-end: 0;
    }

    .tablist {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--_space-inline-sm);
        min-inline-size: 0;
    }

    :host([appearance="closed"]) .tablist {
        gap: var(--_space-stack-2xs);
    }

    :host([orientation="vertical"]) .tablist-shell {
        border-block-end: 0;
        padding-inline-end: var(--_space-inline-sm);
    }

    :host([orientation="vertical"]) .tablist {
        flex-direction: column;
        align-items: stretch;
    }

    .panel-region {
        min-inline-size: 0;
    }

    :host([appearance="open"]) .panel-region {
        padding-block-start: var(--_space-stack-xs);
    }

    :host([appearance="closed"]) .panel-region,
    :host([appearance="mixed"]) .panel-region {
        padding: var(--_panel-padding);
        border: 1px solid var(--_panel-border);
        border-radius: var(--_radius-lg, 6px);
        background: var(--_panel-background);
        box-shadow: var(--_panel-shadow);
    }

    :host([orientation="horizontal"][appearance="closed"]) .panel-region,
    :host([orientation="horizontal"][appearance="mixed"]) .panel-region {
        border-start-start-radius: 0;
    }

    :host([orientation="vertical"][appearance="closed"]) .panel-region,
    :host([orientation="vertical"][appearance="mixed"]) .panel-region {
        border-start-start-radius: 0;
    }
`,Vv=u`
    <div class="tablist-shell" part="tablist-shell">
        <div class="tablist" part="tablist" role="tablist" aria-orientation="${t=>t.orientation}">
            <slot name="tab" @slotchange="${t=>t.handleTabSlotChange()}"></slot>
        </div>
    </div>
    <div class="panel-region" part="panel-region" ?hidden="${t=>!t.hasPanels}">
        <slot name="tabpanel" @slotchange="${t=>t.handlePanelSlotChange()}"></slot>
    </div>
`;function Pv(t){return t.tagName==="VIOLET-TAB"}function Bv(t){return t.tagName==="VIOLET-TAB-PANEL"}var ht=class extends f{#e=e=>{if(this.disabled)return;let i=e.currentTarget;!i||this.#u(i)||(i.focus(),this.activeid=i.id)};#t=e=>{if(this.disabled)return;let i=e,r=i.currentTarget;if(!(!r||this.#u(r)))switch(i.key){case"ArrowLeft":this.orientation==="horizontal"&&(i.preventDefault(),this.#c(this.#h()?1:-1));break;case"ArrowRight":this.orientation==="horizontal"&&(i.preventDefault(),this.#c(this.#h()?-1:1));break;case"ArrowUp":this.orientation==="vertical"&&(i.preventDefault(),this.#c(-1));break;case"ArrowDown":this.orientation==="vertical"&&(i.preventDefault(),this.#c(1));break;case"Home":i.preventDefault(),this.#d("start");break;case"End":i.preventDefault(),this.#d("end");break;case"Enter":case" ":i.preventDefault(),this.activeid=r.id;break}};constructor(){super(),this.tabs=[],this.panels=[],this.hasPanels=!1,this.appearance="open",this.disabled=!1,this.orientation="horizontal",this.activeid="",this.activetab=null}connectedCallback(){super.connectedCallback(),this.#i(),this.#r(),this.#o(!1)}disconnectedCallback(){this.#s(this.tabs),super.disconnectedCallback()}appearanceChanged(){this.$fastController.isConnected&&this.#o(!1)}disabledChanged(){this.$fastController.isConnected&&this.#o(!1)}orientationChanged(){this.$fastController.isConnected&&this.#o(!1)}activeidChanged(e,i){this.$fastController.isConnected&&this.#o(e!==i)}handleTabSlotChange(){this.#i(),this.#o(!1)}handlePanelSlotChange(){this.#r(),this.#o(!1)}#i(){let e=Array.from(this.children).filter(Pv);e.forEach(i=>{i.slot!=="tab"&&(i.slot="tab")}),this.#s(this.tabs),this.tabs=e,this.#n(this.tabs)}#r(){this.panels=Array.from(this.children).filter(Bv),this.panels.forEach(e=>{e.slot!=="tabpanel"&&(e.slot="tabpanel")}),this.hasPanels=this.panels.length>0}#n(e){e.forEach(i=>{i.addEventListener("click",this.#e),i.addEventListener("keydown",this.#t)})}#s(e){e.forEach(i=>{i.removeEventListener("click",this.#e),i.removeEventListener("keydown",this.#t)})}#o(e){if(this.tabs.length===0){this.activetab=null,this.hasPanels=this.panels.length>0;return}let i=this.#a(),r=this.tabs[i]??null;this.activetab=r;let o=Math.min(this.tabs.length,this.panels.length);if(this.tabs.forEach((s,n)=>{s.id||(s.id=`violet-tab-${++wu}`),s.slot!=="tab"&&(s.slot="tab"),s.setAttribute("role","tab");let a=n<o?this.panels[n]:null;a&&!a.id&&(a.id=`violet-tab-panel-${++wu}`),a&&a.slot!=="tabpanel"&&(a.slot="tabpanel"),a&&a.setAttribute("role","tabpanel");let l=n===i,d=this.#u(s),h=l&&!d;s.syncPresentation(this.#l(l),this.orientation),s.setDisabledFromTabs(this.disabled),s.setAttribute("aria-disabled",d?"true":"false"),s.setAttribute("aria-selected",l?"true":"false"),s.tabIndex=h?0:-1,a?(s.setAttribute("aria-controls",a.id),a.setAttribute("aria-labelledby",s.id),a.hidden=!l,a.tabIndex=0,a.setAttribute("data-orientation",this.orientation),a.setAttribute("data-appearance",this.appearance)):s.removeAttribute("aria-controls")}),this.panels.forEach((s,n)=>{n>=o&&(s.hidden=!0)}),r&&this.activeid!==r.id){this.activeid=r.id;return}this.hasPanels=this.panels.length>0,e&&r&&this.$emit("change",r)}#a(){let e=this.tabs.findIndex(o=>o.id===this.activeid&&!this.#u(o));if(e>=0)return e;let i=this.tabs.findIndex(o=>o.getAttribute("aria-selected")==="true"&&!this.#u(o));if(i>=0)return i;let r=this.tabs.findIndex(o=>!this.#u(o));return r>=0?r:0}#l(e){return this.appearance==="mixed"?e?"mixed":"open":this.appearance}#c(e){let i=this.tabs.filter(n=>!this.#u(n));if(i.length===0)return;let o=((this.activetab?i.indexOf(this.activetab):0)+e+i.length)%i.length,s=i[o];s&&(s.focus(),this.activeid=s.id)}#d(e){let i=this.tabs.filter(o=>!this.#u(o));if(i.length===0)return;let r=e==="start"?i[0]:i[i.length-1];r&&(r.focus(),this.activeid=r.id)}#u(e){return this.disabled||e.disabled}#h(){return getComputedStyle(this).direction==="rtl"}};Tn([m],ht.prototype,"tabs",void 0);Tn([m],ht.prototype,"panels",void 0);Tn([m],ht.prototype,"hasPanels",void 0);c(ht.prototype,"appearance");c({mode:"boolean"})(ht.prototype,"disabled");c(ht.prototype,"orientation");c(ht.prototype,"activeid");customElements.get("violet-tabs")||await f.define(ht,{name:"violet-tabs",template:Vv,styles:Lv});Gr();es();Gr();es();var ar=null,Fn,Rn,Dn=new Set,Tu=new WeakSet;function Mn(){return ar?.presets??Zo}function Iu(){return ar?.defaultPreset??nr}function Au(){return ar!==null?ar.cssText:Fn===void 0?(On().catch(t=>{console.error("violet-theme: the built-in theme failed to load; the next install retries",t)}),""):Fn}function On(){return Rn??=Wv().then(t=>{let e=t.violetThemeCssText;return Fn=e,ar===null&&Mu(),e}).catch(t=>{throw Rn=void 0,t}),Rn}var Wv=()=>Promise.resolve().then(()=>(An(),Eu));function Ru(t){return typeof ShadowRoot<"u"&&t instanceof ShadowRoot}function Fu(t){return typeof Document<"u"&&t instanceof Document}function Uv(t=document){return Ru(t)?t:Fu(t)?t.head??t.documentElement:document.head??document.documentElement}function Du(t){let e=Uv(t),i=e.querySelector('style[data-violet-theme="runtime"]'),r=Ru(t)?t.ownerDocument:Fu(t)?t:document,o=i instanceof HTMLStyleElement?i:r.createElement("style");return o.dataset.violetTheme="runtime",o.textContent=Au(),o.isConnected||e.append(o),Tu.has(o)||(Tu.add(o),Dn.add(new WeakRef(o))),o}function Mu(){let t=Au();for(let e of Dn){let i=e.deref();i===void 0?Dn.delete(e):i.textContent=t}}function ts(t=document){return Du(t)}function Ou(t,e=document){return ar={cssText:Kr(t),presets:Object.keys(t.presets),defaultPreset:t.defaultPreset},Mu(),Du(e)}function is(){return Mn()}function Ln(){return Iu()}function rs(t){return typeof t=="string"&&Mn().includes(t)}function Lu(t){if(t==null||t==="")return Iu();if(rs(t))return t;throw new RangeError(`Unknown Violet theme preset '${t}'; the installed presets are ${Mn().join(", ")}`)}function Vu(t,e){let i=Lu(e);return t.setAttribute(mi,""),t.setAttribute(gi,i),t}An();Gr();var Kv=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Gv=v`
    :host {
        display: contents;
    }
`,Yv=u`
    <slot></slot>
`,os=class extends f{connectedCallback(){super.connectedCallback();let e=this.getRootNode();ts(e instanceof ShadowRoot?e:this.ownerDocument),this.setAttribute(mi,""),this.applyPreset()}presetChanged(){this.$fastController.isConnected&&this.applyPreset()}applyPreset(){let e=this.getAttribute("preset")||this.preset||Ln();rs(e)||console.warn(`violet-theme: the preset '${e}' is not in the installed theme set (${is().join(", ")})`),this.setAttribute(gi,e)}};Kv([c],os.prototype,"preset",void 0);customElements.get("violet-theme")||await f.define(os,{name:"violet-theme",template:Yv,styles:Gv});var Bu=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s};Ne();var Pu=0,Xv=v`
    ${E}

    :host {
        display: inline-block;
        position: relative;

        --_tip-border-width: var(--violet-teaching-tip-border-width, var(--_card-border-width, 1px));
        --_tip-padding: var(--violet-teaching-tip-padding, var(--_space-md));
        --_tip-max-width: var(--violet-teaching-tip-max-width, 320px);
        --_tip-radius: var(--violet-teaching-tip-radius, var(--_radius-lg));
        --_tip-gap: var(--violet-teaching-tip-gap, var(--_space-sm));
        --_tip-background: var(--violet-teaching-tip-background, var(--_surface-card));
        --_tip-shadow: var(--violet-teaching-tip-shadow, var(--_shadow-floating));
        --_tip-border-color: var(--violet-teaching-tip-border-color, var(--_border-subtle));
    }

    .anchor {
        display: inline-block;
        anchor-name: --violet-teaching-tip-anchor;
    }

    .tip {
        box-sizing: border-box;
        position: fixed;
        position-anchor: --violet-teaching-tip-anchor;
        margin: 0;
        padding: 0;
        border: var(--_tip-border-width) solid var(--_tip-border-color);
        border-radius: var(--_tip-radius);
        background: var(--_tip-background);
        box-shadow: var(--_tip-shadow);
        color: inherit;
        font-family: inherit;
        max-inline-size: var(--_tip-max-width);
        inline-size: var(--_tip-max-width);
        z-index: var(--_layer-popover);

        opacity: 0;
        transform: scale(0.96);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .tip:popover-open {
        opacity: 1;
        transform: scale(1);

        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }

    :host([positioning="above"]) .tip {
        position-area: block-start center;
        margin-block-end: var(--_tip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="below"]) .tip {
        position-area: block-end center;
        margin-block-start: var(--_tip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="before"]) .tip {
        position-area: center left;
        margin-inline-end: var(--_tip-gap);
        position-try-fallbacks: flip-inline;
    }

    :host([positioning="after"]) .tip {
        position-area: center right;
        margin-inline-start: var(--_tip-gap);
        position-try-fallbacks: flip-inline;
    }

    .header {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_tip-padding);
        padding-block-end: 0;
    }

    .header[hidden] {
        display: none;
    }

    .title {
        flex: 1;
        font-weight: 600;
        font-size: 13px;
        min-inline-size: 0;
    }

    .close-button {
        flex-shrink: 0;
        margin-inline-start: auto;
    }

    .body {
        padding: var(--_tip-padding);
        font-size: 12px;
        line-height: 16px;
    }

    .footer {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_tip-padding);
        padding-block-start: 0;
    }

    .footer[hidden] {
        display: none;
    }

    .step-indicator {
        font-size: 11px;
        color: var(--_text-secondary, #414651);
        margin-inline-end: auto;
    }

    .step-indicator[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .tip {
            forced-color-adjust: none;
            border: var(--_tip-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }
    }
`,Qv=u`
    <span class="anchor" part="anchor">
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </span>
    <div
        class="tip"
        part="tip"
        id="${t=>t.tipId}"
        role="dialog"
        aria-labelledby="${t=>t.hasTitle?t.titleId:void 0}"
        aria-label="${t=>t.hasTitle?void 0:"Teaching tip"}"
        popover="auto"
    >
        <div class="header" part="header" ?hidden="${t=>!t.hasTitle&&t.noCloseButton}">
            <span class="title" part="title" id="${t=>t.titleId}">
                <slot name="title" @slotchange="${t=>t.handleTitleSlotChange()}"></slot>
            </span>
            <violet-icon-button
                class="close-button"
                part="close-button"
                ?hidden="${t=>t.noCloseButton}"
                appearance="quiet"
                label="Dismiss tip"
                @click="${t=>t.hide()}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
        <div class="body" part="body">
            <slot name="body">${t=>t.content}</slot>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter&&!t.totalSteps}">
            <span
                class="step-indicator"
                part="step-indicator"
                ?hidden="${t=>!t.totalSteps}"
            >${t=>t.totalSteps?`${t.currentStep} of ${t.totalSteps}`:""}</span>
            <slot name="footer" @slotchange="${t=>t.handleFooterSlotChange()}"></slot>
        </div>
    </div>
`,Pe=class extends f{#e=null;#t=null;#i=!1;constructor(){super(),this.hasTitle=!1,this.hasFooter=!1,this.content="",this.positioning="below",this.open=!1,this.noCloseButton=!1,this.currentStep=0,this.totalSteps=0;let e=Pu;Pu+=1,this.tipId=`violet-teaching-tip-${e}`,this.titleId=`violet-teaching-tip-title-${e}`}get#r(){return this.shadowRoot?.querySelector(".tip")??null}show(){this.open=!0}hide(){this.open=!1}connectedCallback(){super.connectedCallback();let e=this.#r;e&&e.addEventListener("toggle",this.#n),this.#s(),this.#a(),this.open&&this.#c()}disconnectedCallback(){super.disconnectedCallback();let e=this.#r;e&&e.removeEventListener("toggle",this.#n),this.#o()}openChanged(){this.$fastController.isConnected&&(this.open?this.#c():this.#d(),this.#a())}anchorChanged(){this.$fastController.isConnected&&(this.#o(),this.#s(),this.#a())}handleSlotChange(){let i=this.shadowRoot?.querySelector("slot:not([name])")?.assignedElements({flatten:!0})??[];this.#e instanceof HTMLElement&&!this.#i&&this.#l(this.#e),this.#e=i[0]??null,this.#a()}handleTitleSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="title"]');this.hasTitle=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#n=e=>{let r=e.newState==="open";this.open=r,this.#a(),this.$emit("open-change",{open:r}),r||this.$emit("dismiss")};#s(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#t=e,this.#e=e,e.style.setProperty("anchor-name","--violet-teaching-tip-anchor"),this.#i=!0)}#o(){!this.#i||!this.#t||(this.#l(this.#t),this.#t.style.removeProperty("anchor-name"),this.#t=null,this.#i=!1)}#a(){if(!(this.#e instanceof HTMLElement))return;this.#e.setAttribute("aria-haspopup","dialog"),this.#e.setAttribute("aria-expanded",String(this.open));let e=this.shadowRoot;e&&"referenceTarget"in ShadowRoot.prototype?(e.referenceTarget=this.tipId,this.id||(this.id=`${this.tipId}-host`),this.#e.setAttribute("aria-controls",this.id)):this.#e.removeAttribute("aria-controls")}#l(e){e.removeAttribute("aria-haspopup"),e.removeAttribute("aria-expanded"),e.removeAttribute("aria-controls")}#c(){let e=this.#r;if(e)try{e.showPopover()}catch{e.toggleAttribute("popover-open",!0),e.style.display="block"}}#d(){let e=this.#r;if(e)try{e.hidePopover()}catch{e.removeAttribute("popover-open"),e.style.display=""}}};Bu([m],Pe.prototype,"hasTitle",void 0);Bu([m],Pe.prototype,"hasFooter",void 0);c(Pe.prototype,"content");c(Pe.prototype,"positioning");c({mode:"boolean"})(Pe.prototype,"open");c(Pe.prototype,"anchor");c({attribute:"no-close-button",mode:"boolean"})(Pe.prototype,"noCloseButton");c({attribute:"current-step",converter:{fromView:t=>Number.parseInt(t,10)||0,toView:t=>String(t)}})(Pe.prototype,"currentStep");c({attribute:"total-steps",converter:{fromView:t=>Number.parseInt(t,10)||0,toView:t=>String(t)}})(Pe.prototype,"totalSteps");customElements.get("violet-teaching-tip")||await f.define(Pe,{name:"violet-teaching-tip",template:Qv,styles:Xv});var Jv=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},ss=0;zs();var Zv=v`
    ${F}

    :host {
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-frame {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: var(--_target-size);
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_field-border);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .control-frame:hover {
        border-color: var(--_field-border-hover);
    }

    .control-frame:focus-within {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .control-frame,
    :host(:disabled) .control-frame {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .control-frame {
        border-color: var(--_danger-border);
    }

    .input {
        appearance: none;
        -webkit-appearance: none;
        flex: 1 1 auto;
        min-inline-size: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: 1;
        outline: none;
    }

    .input::-webkit-calendar-picker-indicator,
    .input::-webkit-clear-button,
    .input::-webkit-inner-spin-button {
        display: none;
        opacity: 0;
        pointer-events: none;
    }

    .input::-webkit-date-and-time-value {
        min-block-size: auto;
        padding: 0;
        text-align: start;
    }

    .icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
        pointer-events: none;
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .control-frame {
            border-color: ButtonText;
        }

        .control-frame:focus-within {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .control-frame,
        :host(:disabled) .control-frame {
            border-color: GrayText;
        }
    }
`,eb=u`
    <div class="field" part="field">
        ${b(t=>!!t.label,u`<label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>`)}
        <div class="control-frame" part="control-frame">
            <input
                id="${t=>t.inputId}"
                class="input"
                part="input"
                type="time"
                name="${t=>t.name}"
                :value="${t=>t.value}"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.stepValue}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-describedby="${t=>t.describedBy||null}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
            <span class="icon" aria-hidden="true">
                <violet-icon icon="system/clock" decorative></violet-icon>
            </span>
        </div>
        ${b(t=>!!t.supportingText,u`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${b(t=>!!t.displayErrorText,u`<p class="error" part="error-message" id="${t=>t.errorId}">${t=>t.displayErrorText}</p>`)}
    </div>
`,pe=class extends f{static{this.formAssociated=!0}#e;#t="";constructor(){super(),this.#e=this.attachInternals(),this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.min="",this.max="",this.step="60",this.required=!1,this.disabled=!1,this.invalid=!1,this.size="natural",ss+=1,this.inputId=`violet-time-picker-input-${ss}`,this.supportingId=`violet-time-picker-supporting-${ss}`,this.errorId=`violet-time-picker-error-${ss}`}connectedCallback(){super.connectedCallback(),this.#t=this.value,this.#r()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get describedBy(){return[this.supportingText?this.supportingId:"",this.displayErrorText?this.errorId:""].filter(Boolean).join(" ")}get displayErrorText(){return this.validationMessageText||this.errorText}get stepValue(){return this.step||"60"}valueChanged(){this.#i(),this.#r()}invalidChanged(){this.#r()}errorTextChanged(){this.#r()}minChanged(){this.#r()}maxChanged(){this.#r()}handleInput(e){let i=e.currentTarget;this.value=i?.value??"",this.#r(),this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#r(),this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#r()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get inputElement(){return this.shadowRoot?.querySelector('input[type="time"]')}#i(){let e=this.inputElement;e&&e.value!==this.value&&(e.value=this.value)}#r(){let e=this.inputElement,i=this.required&&!this.value,r=this.value?!en(this.value):!1,o=this.invalid?this.errorText||"Enter a valid time.":"",s=p=>{let x=en(p);return x?x.hour*3600+x.minute*60+x.second:null},n=this.value&&!r?s(this.value):null,a=s(this.min),l=s(this.max),d=n!==null&&a!==null&&n<a,h=n!==null&&l!==null&&n>l;this.validationMessageText=o||(i?"Please choose a time.":r?"Enter a valid time.":d?`Choose a time at or after ${this.min}.`:h?`Choose a time at or before ${this.max}.`:""),this.#e.setFormValue(this.value||null),this.#e.setValidity({valueMissing:i,badInput:r,rangeUnderflow:d,rangeOverflow:h,customError:!!o},this.validationMessageText,e??void 0)}};Jv([m],pe.prototype,"validationMessageText",void 0);c(pe.prototype,"label");c({attribute:"supporting-text"})(pe.prototype,"supportingText");c({attribute:"error-text"})(pe.prototype,"errorText");c(pe.prototype,"value");c(pe.prototype,"name");c(pe.prototype,"min");c(pe.prototype,"max");c(pe.prototype,"step");c({mode:"boolean"})(pe.prototype,"required");c({mode:"boolean"})(pe.prototype,"disabled");q(pe.prototype);c({mode:"boolean"})(pe.prototype,"invalid");c(pe.prototype,"size");customElements.get("violet-time-picker")||await f.define(pe,{name:"violet-time-picker",template:eb,styles:Zv});var tb=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},Nu=0;function ju(t){return(t.getAttribute("aria-describedby")??"").split(/\s+/).filter(Boolean)}var ib=v`
    ${E}

    :host {
        display: inline-block;
        position: relative;

        --_tooltip-border-width: var(--violet-tooltip-border-width, var(--_card-border-width, 1px));
        --_tooltip-font-size: var(--violet-tooltip-font-size, 12px);
        --_tooltip-line-height: var(--violet-tooltip-line-height, 16px);
        --_tooltip-max-width: var(--violet-tooltip-max-width, 240px);
        --_tooltip-gap: var(--violet-tooltip-gap, var(--_space-sm));
        --_tooltip-radius: var(--violet-tooltip-radius, var(--_radius-md));
        --_tooltip-background: var(--violet-tooltip-background, var(--_surface-card));
        --_tooltip-shadow: var(--violet-tooltip-shadow, var(--_shadow-floating));
        --_tooltip-border-color: var(--violet-tooltip-border-color, var(--_border-subtle));
    }

    .anchor {
        display: inline-block;
        anchor-name: --violet-tooltip-anchor;
    }

    .tooltip {
        box-sizing: border-box;
        position: fixed;
        position-anchor: --violet-tooltip-anchor;
        margin: 0;
        padding: var(--_space-sm) var(--_space-md);
        border: var(--_tooltip-border-width) solid var(--_tooltip-border-color);
        border-radius: var(--_tooltip-radius);
        background: var(--_tooltip-background);
        box-shadow: var(--_tooltip-shadow);
        color: inherit;
        font-family: inherit;
        font-size: var(--_tooltip-font-size);
        line-height: var(--_tooltip-line-height);
        max-inline-size: var(--_tooltip-max-width);
        pointer-events: none;
        z-index: var(--_layer-popover);
        opacity: 0;
        transform: scale(0.96);
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    .tooltip:popover-open {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;

        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }

    :host([positioning="above"]) .tooltip {
        position-area: block-start center;
        margin-block-end: var(--_tooltip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="below"]) .tooltip {
        position-area: block-end center;
        margin-block-start: var(--_tooltip-gap);
        position-try-fallbacks: flip-block;
    }

    :host([positioning="before"]) .tooltip {
        position-area: center left;
        margin-inline-end: var(--_tooltip-gap);
        position-try-fallbacks: flip-inline;
    }

    :host([positioning="after"]) .tooltip {
        position-area: center right;
        margin-inline-start: var(--_tooltip-gap);
        position-try-fallbacks: flip-inline;
    }

    @media (forced-colors: active) {
        .tooltip {
            forced-color-adjust: none;
            border: var(--_tooltip-border-width) solid ButtonText;
            background: Canvas;
            box-shadow: none;
        }
    }
`,rb=u`
    <span class="anchor" part="anchor">
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </span>
    <div
        class="tooltip"
        part="tooltip"
        id="${t=>t.tooltipId}"
        role="tooltip"
        popover="hint"
    >
        <slot name="content" @slotchange="${t=>t.syncDescription()}">${t=>t.content}</slot>
    </div>
`,Mt=class extends f{#e=null;#t=null;#i=null;#r=null;#n=!1;#s=[];#o=null;constructor(){super(),this.content="",this.positioning="above",this.delay=250,this.open=!1;let e=Nu;Nu+=1,this.tooltipId=`violet-tooltip-${e}`}get#a(){return this.shadowRoot?.querySelector(".tooltip")??null}get#l(){return this.shadowRoot?.querySelector(".anchor")??null}connectedCallback(){super.connectedCallback();let e=this.#l;e&&(e.addEventListener("mouseenter",this.#h),e.addEventListener("mouseleave",this.#p),e.addEventListener("focusin",this.#b),e.addEventListener("focusout",this.#y));let i=this.#a;i&&(i.addEventListener("mouseenter",this.#f),i.addEventListener("mouseleave",this.#m),i.addEventListener("toggle",this.#v)),this.#d(),this.open&&this.#k()}disconnectedCallback(){super.disconnectedCallback(),this.#w(),this.#u()}openChanged(){this.$fastController.isConnected&&(this.open?this.#k():this.#R())}anchorChanged(){this.$fastController.isConnected&&(this.#u(),this.#d(),this.#n||this.handleSlotChange())}contentChanged(){this.syncDescription()}handleSlotChange(){if(this.#n)return;let i=this.shadowRoot?.querySelector("slot:not([name])")?.assignedElements({flatten:!0})??[];this.#c(),this.#i=i[0]??null,this.syncDescription()}syncDescription(){let e=this.#i;if(this.#c(),!e)return;let r=this.shadowRoot?.querySelector('slot[name="content"]')?.assignedElements({flatten:!0})??[];if(r.length>0){let o=r.map((n,a)=>(n.id||(n.id=`${this.tooltipId}-content-${a}`),n.id)),s=ju(e).filter(n=>!o.includes(n));e.setAttribute("aria-describedby",[...s,...o].join(" ")),this.#s=o}else this.content&&(e.setAttribute("aria-description",this.content),this.#o=this.content)}#c(){let e=this.#i;if(e&&this.#s.length>0){let i=ju(e).filter(r=>!this.#s.includes(r));i.length>0?e.setAttribute("aria-describedby",i.join(" ")):e.removeAttribute("aria-describedby")}e&&this.#o!==null&&e.getAttribute("aria-description")===this.#o&&e.removeAttribute("aria-description"),this.#s=[],this.#o=null}#d(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#c(),this.#r=e,this.#i=e,e.style.setProperty("anchor-name","--violet-tooltip-anchor"),this.syncDescription(),e.addEventListener("mouseenter",this.#h),e.addEventListener("mouseleave",this.#p),e.addEventListener("focusin",this.#b),e.addEventListener("focusout",this.#y),this.#n=!0)}#u(){!this.#n||!this.#i||!this.#r||(this.#i.removeEventListener("mouseenter",this.#h),this.#i.removeEventListener("mouseleave",this.#p),this.#i.removeEventListener("focusin",this.#b),this.#i.removeEventListener("focusout",this.#y),this.#c(),this.#r.style.removeProperty("anchor-name"),this.#r=null,this.#i=null,this.#n=!1)}#h=()=>{this.#w(),this.#e=setTimeout(()=>{this.open=!0},this.delay)};#p=()=>{this.#w(),this.#t=setTimeout(()=>{this.open=!1},100)};#f=()=>{this.#t&&(clearTimeout(this.#t),this.#t=null)};#m=()=>{this.#t=setTimeout(()=>{this.open=!1},100)};#v=e=>{e.newState==="closed"&&this.open&&(this.#w(),this.open=!1)};#b=()=>{this.#w(),this.open=!0};#y=()=>{this.#w(),this.open=!1};#k(){let e=this.#a;if(e)try{e.showPopover()}catch{e.toggleAttribute("popover-open",!0),e.style.display="block"}}#R(){let e=this.#a;if(e)try{e.hidePopover()}catch{e.removeAttribute("popover-open"),e.style.display=""}}#w(){this.#e&&(clearTimeout(this.#e),this.#e=null),this.#t&&(clearTimeout(this.#t),this.#t=null)}};tb([m],Mt.prototype,"anchor",void 0);c(Mt.prototype,"content");c(Mt.prototype,"positioning");c({converter:{fromView:t=>Number.parseInt(t,10)||250,toView:t=>String(t)}})(Mt.prototype,"delay");c({mode:"boolean"})(Mt.prototype,"open");c(Mt.prototype,"anchor");customElements.get("violet-tooltip")||await f.define(Mt,{name:"violet-tooltip",template:rb,styles:ib});var Vn=function(t,e,i,r){var o=arguments.length,s=o<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(t,e,i,r);else for(var a=t.length-1;a>=0;a--)(n=t[a])&&(s=(o<3?n(s):o>3?n(e,i,s):n(e,i))||s);return o>3&&s&&Object.defineProperty(e,i,s),s},ob=v`
    ${E}

    :host {
        position: fixed;
        inset-block-end: var(--violet-toast-inset-block-end, var(--_space-lg));
        inset-inline-end: var(--violet-toast-inset-inline-end, var(--_space-lg));
        z-index: var(--_layer-toast);
        inline-size: min(var(--violet-toast-inline-size, 24rem), calc(100vw - (var(--_space-lg) * 2)));
        max-inline-size: calc(100vw - (var(--_space-lg) * 2));
        color: var(--_text-primary);
        --_toast-padding: var(--violet-toast-padding, var(--_space-md));
        --_toast-gap: var(--violet-toast-gap, var(--_space-md));
        --_toast-radius: var(--violet-toast-radius, calc(var(--_radius-lg) * 1.33));
        --_toast-surface: var(--violet-toast-surface, var(--_surface-card));
        --_toast-border: var(--violet-toast-border, var(--_border-subtle));
        --_toast-shadow: var(--violet-toast-shadow, var(--_shadow-floating));
        --_toast-emphasis: var(--violet-toast-emphasis, var(--_text-secondary));
        --_toast-icon-size: var(--violet-toast-icon-size, 1rem);
        --_toast-title-size: var(--violet-toast-title-size, var(--_body-size));
        --_toast-title-line: var(--violet-toast-title-line, var(--_body-line));
        --_toast-body-size: var(--violet-toast-body-size, var(--_body-size));
        --_toast-body-line: var(--violet-toast-body-line, var(--_body-line));
    }

    :host(:not([open])) {
        display: none;
    }

    :host([tone="info"]) {
        --_toast-surface: var(--_surface-floating);
        --_toast-border: color-mix(in srgb, var(--_border-subtle) 70%, var(--_focus-ring));
    }

    :host([tone="success"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-success-background, #E3F1E7) 78%, var(--_surface-card));
        --_toast-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_toast-emphasis: var(--color-state-success-text, #166534);
    }

    :host([tone="warning"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-warning-background, #FDEBCC) 82%, var(--_surface-card));
        --_toast-border: var(--color-state-warning-border, rgba(245, 158, 11, 0.34));
        --_toast-emphasis: var(--color-state-warning-text, #92400E);
    }

    :host([tone="danger"]) {
        --_toast-surface: color-mix(in srgb, var(--color-state-danger-background, #FBE2E2) 82%, var(--_surface-card));
        --_toast-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_toast-emphasis: var(--color-state-danger-text, #B42318);
    }

    .frame {
        --violet-card-radius: var(--_toast-radius);
        --violet-card-padding: var(--_toast-padding);
        --violet-card-background: var(--_toast-surface);
        --violet-card-border-color: var(--_toast-border);
        --violet-card-shadow: var(--_toast-shadow);
    }

    .layout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: var(--_toast-gap);
        align-items: start;
    }

    .leading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: calc(var(--_toast-icon-size) + var(--_space-md));
        block-size: calc(var(--_toast-icon-size) + var(--_space-md));
        border-radius: var(--_radius-round);
        background: color-mix(in srgb, var(--_toast-emphasis) 12%, transparent);
        color: var(--_toast-emphasis);
        flex: 0 0 auto;
    }

    .leading[hidden] {
        display: none;
    }

    .icon-slot {
        display: contents;
    }

    .leading ::slotted(violet-icon) {
        --violet-icon-size: var(--_toast-icon-size);
        color: currentColor;
    }

    .body {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
        font-size: var(--_toast-body-size);
        line-height: var(--_toast-body-line);
    }

    .copy {
        display: grid;
        gap: var(--_space-stack-2xs);
        min-inline-size: 0;
    }

    .title {
        margin: 0;
        color: var(--_toast-emphasis);
        font-size: var(--_toast-title-size);
        line-height: var(--_toast-title-line);
        font-weight: 600;
    }

    .title[hidden] {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .content slot::slotted(*) {
        margin: 0;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_space-sm);
        margin-block-start: var(--_space-stack-xs);
    }

    .actions[hidden] {
        display: none;
    }

    .actions slot::slotted(*) {
        margin: 0;
    }

    .dismiss {
        color: var(--_toast-emphasis);
    }

    .dismiss[hidden] {
        display: none;
    }

    @media (forced-colors: active) {
        .frame::part(root) {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
        }

        .leading {
            background: Canvas;
            color: ButtonText;
            outline: 1px solid ButtonText;
        }
    }
`,sb=u`
    <violet-card class="frame" part="root" appearance="outline" padding="medium">
        <div class="layout" part="layout">
            <span class="leading" part="icon" ?hidden="${t=>!t.showLeading}">
                <slot class="icon-slot" name="icon" @slotchange="${t=>t.handleIconSlotChange()}"></slot>
                ${t=>t.hasIcon?u``:t.defaultIconTemplate}
            </span>

            <div class="body" part="body">
                <div
                    class="copy"
                    part="copy"
                    role="${t=>t.liveRegionRole||null}"
                    aria-live="${t=>t.liveRegionPoliteness||null}"
                >
                    <p class="title" part="title" ?hidden="${t=>!t.hasTitle}">
                        <slot name="title" @slotchange="${t=>t.handleTitleSlotChange()}"></slot>
                    </p>
                    <div class="content" part="content">
                        <slot></slot>
                    </div>
                </div>
                <div class="actions" part="actions" ?hidden="${t=>!t.hasActions}">
                    <slot name="actions" @slotchange="${t=>t.handleActionsSlotChange()}"></slot>
                </div>
            </div>

            <violet-icon-button
                class="dismiss"
                part="dismiss-button"
                appearance="transparent"
                label="Dismiss notification"
                ?hidden="${t=>!t.dismissible}"
                @click="${t=>t.dismiss("dismiss-button")}"
            >
                <violet-icon icon="system/close" decorative></violet-icon>
            </violet-icon-button>
        </div>
    </violet-card>
`,Je=class extends f{#e=null;constructor(){super(),this.hasTitle=!1,this.hasActions=!1,this.hasIcon=!1,this.open=!1,this.tone="default",this.announcement="polite",this.dismissible=!0,this.timeout="5000"}connectedCallback(){super.connectedCallback(),gt(),Ne(),Ae(),ii(),this.handleTitleSlotChange(),this.handleActionsSlotChange(),this.handleIconSlotChange(),this.#t()}disconnectedCallback(){super.disconnectedCallback(),this.#i()}openChanged(e,i){!this.$fastController.isConnected||e===i||(this.#t(),this.$emit("open-change",{open:i}))}timeoutChanged(){this.$fastController.isConnected&&this.#t()}handleTitleSlotChange(){this.hasTitle=this.#r('slot[name="title"]')}handleActionsSlotChange(){this.hasActions=this.#r('slot[name="actions"]');let e=this.shadowRoot?.querySelector(".actions");e&&(e.hidden=!this.hasActions),this.$fastController.isConnected&&this.#t()}handleIconSlotChange(){this.hasIcon=this.#r('slot[name="icon"]')}dismiss(e){this.open&&(this.#i(),this.open=!1,this.$emit("dismiss",{reason:e}))}get showLeading(){return this.hasIcon||this.tone==="success"||this.tone==="warning"||this.tone==="danger"}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}get defaultIconTemplate(){return this.tone==="success"?u`<violet-icon icon="system/checkmark" decorative></violet-icon>`:this.tone==="danger"?u`<violet-icon icon="system/dismiss" decorative></violet-icon>`:this.tone==="warning"?u`<violet-icon icon="system/warning" decorative></violet-icon>`:u``}#t(){this.#i();let e=Number.parseInt(this.timeout,10);!this.open||this.hasActions||!Number.isFinite(e)||e<=0||(this.#e=window.setTimeout(()=>{this.dismiss("timeout")},e))}#i(){this.#e!==null&&(window.clearTimeout(this.#e),this.#e=null)}#r(e){let i=this.shadowRoot?.querySelector(e),r=i?.name;return r&&this.querySelector(`[slot="${r}"]`)?!0:(i?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0)}};Vn([m],Je.prototype,"hasTitle",void 0);Vn([m],Je.prototype,"hasActions",void 0);Vn([m],Je.prototype,"hasIcon",void 0);c({mode:"boolean"})(Je.prototype,"open");c(Je.prototype,"tone");c(Je.prototype,"announcement");c({mode:"boolean"})(Je.prototype,"dismissible");c(Je.prototype,"timeout");customElements.get("violet-toast")||await f.define(Je,{name:"violet-toast",template:sb,styles:ob,shadowOptions:{delegatesFocus:!0}});function Hu(){if(typeof DEV_MODE<"u")return DEV_MODE;for(let t in ra())return!0;return!1}var nb=function(t,e,i,r){function o(s){return s instanceof i?s:new i(function(n){n(s)})}return new(i||(i=Promise))(function(s,n){function a(h){try{d(r.next(h))}catch(p){n(p)}}function l(h){try{d(r.throw(h))}catch(p){n(p)}}function d(h){h.done?s(h.value):o(h.value).then(a,l)}d((r=r.apply(t,e||[])).next())})};function Pn(){try{let t=new CustomElementRegistry,r=document.createElement("div").attachShadow({mode:"open",customElementRegistry:t,registry:t});return r.customElementRegistry===t||r.registry===t}catch{return!1}}function Wu(){return nb(this,void 0,void 0,function*(){if(Pn())return;let t=globalThis;return t.__scopedRegistryPolyfillPromise||(t.__scopedRegistryPolyfillPromise=Promise.resolve().then(()=>th(qu(),1)).then(()=>{t.__scopedRegistryPolyfillApplied=!0,Hu()&&console.info("[fast-af] Scoped registry polyfill loaded successfully")}).catch(e=>{t.__scopedRegistryPolyfillApplied=!1,t.__scopedRegistryPolyfillPromise=void 0;let i=new Error("[fast-af] Failed to load scoped registry polyfill");throw i.cause=e,i})),t.__scopedRegistryPolyfillPromise})}export{f as FASTElement,ve as FASTElementDefinition,Vu as applyVioletThemeRoot,Wu as ensureScopedRegistrySupport,ea as getAllSchemas,Zn as getSchema,is as getVioletThemePresets,u as html,ts as installVioletTheme,Ou as installVioletThemeSet,On as loadVioletBuiltInTheme,Pn as supportsScopedRegistries};
