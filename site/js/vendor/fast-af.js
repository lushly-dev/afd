/* @lushly-dev/violet-elements 0.2.0-preview.6 on @lushly-dev/fast-element 3.1.4-preview.0, bundled for the FAST-AF pages by scripts/build-site-fast-af.mjs. Do not edit. */
var Sf=Object.create;var Nn=Object.defineProperty;var zf=Object.getOwnPropertyDescriptor;var Ef=Object.getOwnPropertyNames;var Tf=Object.getPrototypeOf,$f=Object.prototype.hasOwnProperty;var yi=(t,e,i)=>()=>{if(i)throw i[0];try{return t&&(e=t(t=0)),e}catch(o){throw i=[o],o}};var If=(t,e)=>()=>{try{return e||t((e={exports:{}}).exports,e),e.exports}catch(i){throw e=0,i}},Ha=(t,e)=>{for(var i in e)Nn(t,i,{get:e[i],enumerable:!0})},Af=(t,e,i,o)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of Ef(e))!$f.call(t,r)&&r!==i&&Nn(t,r,{get:()=>e[r],enumerable:!(o=zf(e,r))||o.enumerable});return t};var Rf=(t,e,i)=>(i=t!=null?Sf(Tf(t)):{},Af(e||!t||!t.__esModule?Nn(i,"default",{value:t,enumerable:!0}):i,t));var Ph={};Ha(Ph,{FallbackPositionController:()=>_n,clearAnchorName:()=>dy,clearFallbackPosition:()=>Qs,computeFallbackPosition:()=>Oh,createAnchorName:()=>Tt,normalizePlacement:()=>Vh,positionFloatingFallback:()=>Lh,resolveCssLengthPx:()=>Mh,startLazyFallback:()=>hy,supportsCssAnchorPositioning:()=>kn,syncAnchorNames:()=>uy});function dy(t,e){t&&t.style.getPropertyValue("anchor-name").trim()===e&&t.style.removeProperty("anchor-name")}function uy(t){$t(t.internalAnchor,t.externalAnchor,t.floating,t.anchorName)}function Mh(t,e,i=8){let o=t.trim();if(!o)return i;if(o==="0")return 0;let r=/^(-?(?:\d+\.?\d*|\.\d+))px$/i.exec(o);if(r)return Number.parseFloat(r[1]);if(e.isConnected){let a=e.ownerDocument.createElement("div");if(a.style.position="absolute",a.style.visibility="hidden",a.style.pointerEvents="none",a.style.width="0",a.style.height="0",a.style.left=o,a.style.left){(e.shadowRoot??e).append(a);let d=Number.parseFloat(getComputedStyle(a).left);if(a.remove(),Number.isFinite(d))return d}return i}let n=/^(-?(?:\d+\.?\d*|\.\d+))(rem|em|in|cm|mm|pt|pc)$/i.exec(o);if(n){let s=Number.parseFloat(n[1]),a=n[2].toLowerCase();if(a==="rem"){let d=Number.parseFloat(getComputedStyle(e.ownerDocument.documentElement).fontSize)||16;return s*d}if(a==="em"){let d=Number.parseFloat(getComputedStyle(e).fontSize)||16;return s*d}let l={in:96,cm:96/2.54,mm:96/25.4,pt:96/72,pc:16};return s*(l[a]??1)}return i}function Vh(t,e="below"){return t==="above"||t==="below"||t==="before"||t==="after"?t:e}function Oh(t,e,i,o={}){let r=o.gap??8,n=o.margin??8,s=o.align??"center",a=o.placement??"below",l=S=>{if(S==="above"){let F=s==="start"?t.left:t.left+(t.width-e.width)/2;return{top:t.top-e.height-r,left:F}}if(S==="below"){let F=s==="start"?t.left:t.left+(t.width-e.width)/2;return{top:t.bottom+r,left:F}}return S==="before"?{top:s==="start"?t.top:t.top+(t.height-e.height)/2,left:t.left-e.width-r}:{top:s==="start"?t.top:t.top+(t.height-e.height)/2,left:t.right+r}},d=l(a);if(a==="below"&&d.top+e.height>i.height-n){let S=l("above");(S.top>=n||S.top>i.height-(d.top+e.height))&&(a="above",d=S)}else if(a==="above"&&d.top<n){let S=l("below");(S.top+e.height<=i.height-n||i.height-(S.top+e.height)>d.top)&&(a="below",d=S)}else if(a==="after"&&d.left+e.width>i.width-n){let S=l("before");(S.left>=n||S.left>i.width-(d.left+e.width))&&(a="before",d=S)}else if(a==="before"&&d.left<n){let S=l("after");(S.left+e.width<=i.width-n||i.width-(S.left+e.width)>d.left)&&(a="after",d=S)}s==="start"&&(a==="below"||a==="above")&&d.left+e.width>i.width-n&&(d.left=t.right-e.width);let u=Math.max(n,i.width-e.width-n),p=Math.max(n,i.height-e.height-n),v=Math.min(Math.max(d.left,n),u);return{top:Math.min(Math.max(d.top,n),p),left:v,placement:a}}function Lh(t,e,i={}){let o=t.getBoundingClientRect(),r=e.getBoundingClientRect(),n=Oh(o,r,{width:window.innerWidth,height:window.innerHeight},i);return e.style.position="fixed",e.style.inset="auto",e.style.margin="0",e.style.setProperty("position-area","none"),e.style.setProperty("position-try-fallbacks","none"),e.style.top=`${n.top}px`,e.style.left=`${n.left}px`,n}function Qs(t){t&&(t.style.removeProperty("position"),t.style.removeProperty("top"),t.style.removeProperty("left"),t.style.removeProperty("inset"),t.style.removeProperty("margin"),t.style.removeProperty("position-area"),t.style.removeProperty("position-try-fallbacks"))}function hy(t,e,i,o,r){let n=t??new _n;return n.start(e,i,()=>{let[s,a,l,d,u,p]=o();return{placement:Vh(s,a),align:l,gap:Mh(d,u,p)}},r),n}var _n,Bh=yi(()=>{"use strict";yo();_n=class{#e=!1;#t=0;#o=null;#i=null;#r=null;start(e,i,o,r=!1){if(this.stop(),!r&&kn()){Qs(i());return}this.#e=!0,this.#o=e,this.#i=i,this.#r=o,this.update(),this.#t=requestAnimationFrame(()=>{this.#t=0,this.#e&&this.update()}),window.addEventListener("scroll",this.#s,!0),window.addEventListener("resize",this.#s)}update(){if(!this.#e||!this.#o||!this.#i||!this.#r)return;let e=this.#o(),i=this.#i();!e||!i||Lh(e,i,this.#r())}stop(e){this.#t&&(cancelAnimationFrame(this.#t),this.#t=0),this.#e&&(window.removeEventListener("scroll",this.#s,!0),window.removeEventListener("resize",this.#s),this.#e=!1);let i=e??this.#i?.()??null;Qs(i),this.#o=null,this.#i=null,this.#r=null}#s=()=>{this.update()}}});function py(){return Js||(Js=Promise.resolve().then(()=>(Bh(),Ph)).then(t=>(Zs=t,t))),Js}function Tt(t,e){return`--${t}-anchor-${e}`}function kn(){return!!(typeof CSS<"u"&&CSS.supports?.("(anchor-name: --a) and (position-area: block-end center) and (position-try-fallbacks: flip-block)"))}function $t(t,e,i,o){if(e){t?.style.removeProperty("anchor-name"),i?.style.removeProperty("position-anchor");return}t?.style.setProperty("anchor-name",o),i?.style.setProperty("position-anchor",o)}var Zs,Js,It,yo=yi(()=>{"use strict";Zs=null,Js=null;It=class{#e=null;#t=0;start(e,i,o,r=!1){let n=++this.#t;if(!r&&kn()){this.#e?.stop(i());return}let s=a=>{n===this.#t&&(this.#e=a.startLazyFallback(this.#e,e,i,o,r))};if(Zs){s(Zs);return}py().then(s)}update(){this.#e?.update()}stop(e){this.#t+=1,this.#e?.stop(e)}}});function na(t,e=""){let i=t.replaceAll(".","-");return e?`--${e}-${i}`:`--${i}`}var Ap,Rp=yi(()=>{"use strict";Ap="violet"});function yx(t){let e=[],i=null;for(let o of t)if(i!==null)o===i&&(i=null);else if(o==='"'||o==="'")i=o;else if(o==="("||o==="[")e.push(o);else if(o in Dp&&e.pop()!==Dp[o])return!1;return i===null&&e.length===0}function $n(t){return na(t,Ap)}function xx(t){return na(t)}function wx(t){let e=[],i=t?.presets;if(typeof i!="object"||i===null||Array.isArray(i))return["the theme set has no presets object"];let o=Object.keys(i);o.length===0&&e.push("the theme set has no presets"),(typeof t.defaultPreset!="string"||!o.includes(t.defaultPreset))&&e.push(`the default preset '${String(t.defaultPreset)}' is not one of the presets (${o.join(", ")})`);for(let r of o){vx.test(r)||e.push(`the preset name '${r}' must be letters, digits, '-' and '_', starting with a letter or digit`);let n=i[r];if(!Array.isArray(n)){e.push(`the preset '${r}' is not a list of { id, value } tokens`);continue}let s=new Set;for(let a of n){let l=a?.id;if(typeof l!="string"||!gx.test(l)){e.push(`the preset '${r}' has a token with an invalid id ${JSON.stringify(l)}`);continue}s.has(l)&&e.push(`the preset '${r}' lists '${l}' more than once`),s.add(l);let d=a.value;(typeof d!="string"||d.trim()===""||bx.test(d)||!yx(d))&&e.push(`the preset '${r}' has an empty or unsafe value for '${l}': ${JSON.stringify(d)}`)}}return e}function Fp(t){return t.map(e=>`  ${$n(e.id)}: ${e.value};`).join(`
`)}function _x(t){return[...new Set(Object.values(t.presets).flatMap(i=>i.map(o=>o.id)))].map(i=>`  ${xx(i)}: var(${$n(i)});`).join(`
`)}function In(t){let e=wx(t);if(e.length>0)throw new TypeError(`Invalid Violet theme set: ${e.join("; ")}`);let i=[":root,",`[${Li}]`,"{",Fp(t.presets[t.defaultPreset]),"}"];for(let[o,r]of Object.entries(t.presets))o!==t.defaultPreset&&i.push(`:root[${$o}="${o}"],`,`[${Li}][${$o}="${o}"]`,"{",Fp(r),"}");return i.push(":root,",`[${Li}]`,"{",_x(t),"}"),i.join(`
`)}var Li,$o,vx,gx,bx,Dp,An=yi(()=>{"use strict";Rp();Li="data-violet-theme-root",$o="data-violet-theme",vx=/^[A-Za-z0-9][A-Za-z0-9_-]*$/,gx=/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/,bx=/[;{}<>]|\/\*|\\|[\r\n]/,Dp={")":"(","]":"["}});var mr,sa,aa=yi(()=>{"use strict";mr="light",sa=["light","dark","high-contrast"]});var Dn,Vp=yi(()=>{"use strict";Dn={defaultPreset:"light",presets:{light:[{id:"color.accent.background",value:"#dfecf4"},{id:"color.accent.text",value:"#1b5f80"},{id:"color.action.danger.background",value:"#c42a1a"},{id:"color.action.danger.hover",value:"#ad2416"},{id:"color.action.danger.pressed",value:"#96200f"},{id:"color.action.danger.text",value:"#ffffff"},{id:"color.action.primary.background",value:"#181b1a"},{id:"color.action.primary.hover",value:"#2f383e"},{id:"color.action.primary.pressed",value:"#262e33"},{id:"color.action.primary.text",value:"#f4f0ea"},{id:"color.action.secondary.background",value:"rgba(24, 27, 26, 0.07)"},{id:"color.action.secondary.border",value:"transparent"},{id:"color.action.secondary.hover",value:"rgba(24, 27, 26, 0.11)"},{id:"color.action.secondary.pressed",value:"rgba(24, 27, 26, 0.15)"},{id:"color.action.secondary.text",value:"#181b1a"},{id:"color.border.strong",value:"#6b7d6e"},{id:"color.border.subtle",value:"rgba(24, 27, 26, 0.10)"},{id:"color.control.selected.background",value:"#c0daeb"},{id:"color.control.selected.border",value:"rgba(27, 95, 128, 0.5)"},{id:"color.control.selected.foreground",value:"#1b5f80"},{id:"color.field.background",value:"#ffffff"},{id:"color.field.background.readonly",value:"rgba(24, 27, 26, 0.05)"},{id:"color.field.border",value:"#869089"},{id:"color.field.border.focus",value:"#28769e"},{id:"color.field.border.hover",value:"#48534b"},{id:"color.field.border.invalid",value:"#c42a1a"},{id:"color.field.placeholder",value:"#5e6460"},{id:"color.field.text",value:"#181b1a"},{id:"color.focus.ring",value:"#28769e"},{id:"color.state.danger.background",value:"#f7e4df"},{id:"color.state.danger.border",value:"transparent"},{id:"color.state.danger.foreground",value:"#c42a1a"},{id:"color.state.danger.text",value:"#c42a1a"},{id:"color.state.success.background",value:"#dfeae3"},{id:"color.state.success.border",value:"transparent"},{id:"color.state.success.foreground",value:"#2c5e4b"},{id:"color.state.success.text",value:"#2c5e4b"},{id:"color.state.warning.background",value:"#f3e8d2"},{id:"color.state.warning.border",value:"transparent"},{id:"color.state.warning.text",value:"#92400e"},{id:"color.surface.card",value:"#f8f9f3"},{id:"color.surface.floating",value:"#ffffff"},{id:"color.surface.highlight",value:"#ffffff"},{id:"color.surface.page",value:"#f4f0ea"},{id:"color.surface.pressed",value:"#d8dcd6"},{id:"color.surface.selected",value:"#dfecf4"},{id:"color.surface.subtle",value:"#e9e5de"},{id:"color.text.muted",value:"#5e6460"},{id:"color.text.primary",value:"#181b1a"},{id:"color.text.secondary",value:"#48534b"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Inter", system-ui, sans-serif'},{id:"font.family.heading",value:'"Space Grotesk", "Segoe UI", system-ui, sans-serif'},{id:"font.family.mono",value:'"IBM Plex Mono", ui-monospace, Consolas, monospace'},{id:"radius.control",value:"8px"},{id:"radius.floating",value:"12px"},{id:"radius.inset",value:"4px"},{id:"radius.round",value:"9999px"},{id:"shadow.card",value:"0 0 0 1px rgba(24, 27, 26, 0.06), 0 1px 2px rgba(24, 27, 26, 0.06), 0 4px 10px -2px rgba(24, 27, 26, 0.06)"},{id:"shadow.control",value:"0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10)"},{id:"shadow.floating",value:"0 0 0 1px rgba(24, 27, 26, 0.08), 0 4px 12px -2px rgba(24, 27, 26, 0.12), 0 18px 40px -8px rgba(24, 27, 26, 0.20)"},{id:"shadow.well",value:"inset 0 2px 3px -1px rgba(0, 0, 0, 0.1)"},{id:"size.focus-ring.width",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.group",value:"8px"},{id:"space.inline.hairline",value:"2px"},{id:"space.inline.tight",value:"4px"},{id:"space.layout.page",value:"24px"},{id:"space.layout.panel",value:"12px"},{id:"space.stack.group",value:"8px"},{id:"space.stack.section",value:"12px"},{id:"space.stack.tight",value:"4px"},{id:"type.body.line",value:"20px"},{id:"type.body.size",value:"14px"},{id:"type.body.weight",value:"400"},{id:"type.caption.line",value:"16px"},{id:"type.caption.size",value:"12px"},{id:"type.caption.weight",value:"400"},{id:"type.heading.page.line",value:"32px"},{id:"type.heading.page.size",value:"24px"},{id:"type.heading.page.weight",value:"600"},{id:"type.heading.section.line",value:"24px"},{id:"type.heading.section.size",value:"18px"},{id:"type.heading.section.weight",value:"600"},{id:"type.label.line",value:"16px"},{id:"type.label.size",value:"13px"},{id:"type.label.weight",value:"500"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}],dark:[{id:"color.accent.background",value:"#162832"},{id:"color.accent.text",value:"#a1d4f3"},{id:"color.action.danger.background",value:"#c42a1a"},{id:"color.action.danger.hover",value:"#ad2416"},{id:"color.action.danger.pressed",value:"#96200f"},{id:"color.action.danger.text",value:"#ffffff"},{id:"color.action.primary.background",value:"#f4f0ea"},{id:"color.action.primary.hover",value:"#d8dcd6"},{id:"color.action.primary.pressed",value:"#bec6bd"},{id:"color.action.primary.text",value:"#141515"},{id:"color.action.secondary.background",value:"rgba(244, 240, 234, 0.09)"},{id:"color.action.secondary.border",value:"transparent"},{id:"color.action.secondary.hover",value:"rgba(244, 240, 234, 0.13)"},{id:"color.action.secondary.pressed",value:"rgba(244, 240, 234, 0.17)"},{id:"color.action.secondary.text",value:"#f4f0ea"},{id:"color.border.strong",value:"#999e9b"},{id:"color.border.subtle",value:"rgba(244, 240, 234, 0.10)"},{id:"color.control.selected.background",value:"#162832"},{id:"color.control.selected.border",value:"rgba(61, 146, 191, 0.5)"},{id:"color.control.selected.foreground",value:"#a1d4f3"},{id:"color.field.background",value:"rgba(0, 0, 0, 0.26)"},{id:"color.field.background.readonly",value:"rgba(244, 240, 234, 0.06)"},{id:"color.field.border",value:"#767b78"},{id:"color.field.border.focus",value:"#3d92bf"},{id:"color.field.border.hover",value:"#999e9b"},{id:"color.field.border.invalid",value:"#ff897a"},{id:"color.field.placeholder",value:"#999e9b"},{id:"color.field.text",value:"#f4f0ea"},{id:"color.focus.ring",value:"#3d92bf"},{id:"color.state.danger.background",value:"#3d211d"},{id:"color.state.danger.border",value:"transparent"},{id:"color.state.danger.foreground",value:"#ff897a"},{id:"color.state.danger.text",value:"#ffab99"},{id:"color.state.success.background",value:"#1b2823"},{id:"color.state.success.border",value:"transparent"},{id:"color.state.success.foreground",value:"#a3ebcd"},{id:"color.state.success.text",value:"#a3ebcd"},{id:"color.state.warning.background",value:"#3a2b18"},{id:"color.state.warning.border",value:"transparent"},{id:"color.state.warning.text",value:"#f3d6a3"},{id:"color.surface.card",value:"#1b1c1c"},{id:"color.surface.floating",value:"#252727"},{id:"color.surface.highlight",value:"#333333"},{id:"color.surface.page",value:"#141515"},{id:"color.surface.pressed",value:"rgba(244, 240, 234, 0.14)"},{id:"color.surface.selected",value:"#162832"},{id:"color.surface.subtle",value:"#202222"},{id:"color.text.muted",value:"#999e9b"},{id:"color.text.primary",value:"#f4f0ea"},{id:"color.text.secondary",value:"#CCCCCC"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Inter", system-ui, sans-serif'},{id:"font.family.heading",value:'"Space Grotesk", "Segoe UI", system-ui, sans-serif'},{id:"font.family.mono",value:'"IBM Plex Mono", ui-monospace, Consolas, monospace'},{id:"radius.control",value:"8px"},{id:"radius.floating",value:"12px"},{id:"radius.inset",value:"4px"},{id:"radius.round",value:"9999px"},{id:"shadow.card",value:"0 0 0 1px rgba(244, 240, 234, 0.07), 0 1px 2px rgba(0, 0, 0, 0.32), 0 6px 14px -2px rgba(0, 0, 0, 0.30)"},{id:"shadow.control",value:"0 0 0 1px rgba(244, 240, 234, 0.07), 0 1px 2px rgba(0, 0, 0, 0.40)"},{id:"shadow.floating",value:"0 0 0 1px rgba(244, 240, 234, 0.13), 0 6px 16px -2px rgba(0, 0, 0, 0.45), 0 22px 48px -8px rgba(0, 0, 0, 0.60)"},{id:"shadow.well",value:"inset 0 2px 3px -1px rgba(0, 0, 0, 0.28)"},{id:"size.focus-ring.width",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.group",value:"8px"},{id:"space.inline.hairline",value:"2px"},{id:"space.inline.tight",value:"4px"},{id:"space.layout.page",value:"24px"},{id:"space.layout.panel",value:"12px"},{id:"space.stack.group",value:"8px"},{id:"space.stack.section",value:"12px"},{id:"space.stack.tight",value:"4px"},{id:"type.body.line",value:"20px"},{id:"type.body.size",value:"14px"},{id:"type.body.weight",value:"400"},{id:"type.caption.line",value:"16px"},{id:"type.caption.size",value:"12px"},{id:"type.caption.weight",value:"400"},{id:"type.heading.page.line",value:"32px"},{id:"type.heading.page.size",value:"24px"},{id:"type.heading.page.weight",value:"600"},{id:"type.heading.section.line",value:"24px"},{id:"type.heading.section.size",value:"18px"},{id:"type.heading.section.weight",value:"600"},{id:"type.label.line",value:"16px"},{id:"type.label.size",value:"13px"},{id:"type.label.weight",value:"500"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}],"high-contrast":[{id:"color.accent.background",value:"#ffffff"},{id:"color.accent.text",value:"#004A80"},{id:"color.action.danger.background",value:"#A30000"},{id:"color.action.danger.hover",value:"#8A0000"},{id:"color.action.danger.pressed",value:"#700000"},{id:"color.action.danger.text",value:"#ffffff"},{id:"color.action.primary.background",value:"#000000"},{id:"color.action.primary.hover",value:"#333333"},{id:"color.action.primary.pressed",value:"#4D4D4D"},{id:"color.action.primary.text",value:"#ffffff"},{id:"color.action.secondary.background",value:"#ffffff"},{id:"color.action.secondary.border",value:"#000000"},{id:"color.action.secondary.hover",value:"#E6E6E6"},{id:"color.action.secondary.pressed",value:"#CCCCCC"},{id:"color.action.secondary.text",value:"#000000"},{id:"color.border.strong",value:"#000000"},{id:"color.border.subtle",value:"#595959"},{id:"color.control.selected.background",value:"#E0E0E0"},{id:"color.control.selected.border",value:"#000000"},{id:"color.control.selected.foreground",value:"#000000"},{id:"color.field.background",value:"#ffffff"},{id:"color.field.background.readonly",value:"#F2F2F2"},{id:"color.field.border",value:"#595959"},{id:"color.field.border.focus",value:"#000000"},{id:"color.field.border.hover",value:"#000000"},{id:"color.field.border.invalid",value:"#A30000"},{id:"color.field.placeholder",value:"#3D3D3D"},{id:"color.field.text",value:"#000000"},{id:"color.focus.ring",value:"#000000"},{id:"color.state.danger.background",value:"#ffffff"},{id:"color.state.danger.border",value:"#A30000"},{id:"color.state.danger.foreground",value:"#A30000"},{id:"color.state.danger.text",value:"#A30000"},{id:"color.state.success.background",value:"#ffffff"},{id:"color.state.success.border",value:"#0B5A1E"},{id:"color.state.success.foreground",value:"#0B5A1E"},{id:"color.state.success.text",value:"#0B5A1E"},{id:"color.state.warning.background",value:"#ffffff"},{id:"color.state.warning.border",value:"#6B3200"},{id:"color.state.warning.text",value:"#6B3200"},{id:"color.surface.card",value:"#ffffff"},{id:"color.surface.floating",value:"#ffffff"},{id:"color.surface.highlight",value:"#ffffff"},{id:"color.surface.page",value:"#ffffff"},{id:"color.surface.pressed",value:"#E6E6E6"},{id:"color.surface.selected",value:"#E0E0E0"},{id:"color.surface.subtle",value:"#F2F2F2"},{id:"color.text.muted",value:"#3D3D3D"},{id:"color.text.primary",value:"#000000"},{id:"color.text.secondary",value:"#1F1F1F"},{id:"duration.base",value:"180ms"},{id:"duration.fast",value:"120ms"},{id:"duration.slow",value:"280ms"},{id:"easing.emphasized",value:"cubic-bezier(0.16, 1, 0.3, 1)"},{id:"easing.standard",value:"cubic-bezier(0.2, 0, 0, 1)"},{id:"font.family.body",value:'"Inter", system-ui, sans-serif'},{id:"font.family.heading",value:'"Space Grotesk", "Segoe UI", system-ui, sans-serif'},{id:"font.family.mono",value:'"IBM Plex Mono", ui-monospace, Consolas, monospace'},{id:"radius.control",value:"8px"},{id:"radius.floating",value:"12px"},{id:"radius.inset",value:"4px"},{id:"radius.round",value:"9999px"},{id:"shadow.card",value:"0 0 0 1px #000000"},{id:"shadow.control",value:"0 0 0 1px #000000"},{id:"shadow.floating",value:"0 0 0 2px #000000"},{id:"shadow.well",value:"inset 0 0 0 0 #000000"},{id:"size.focus-ring.width",value:"2px"},{id:"size.target.comfortable",value:"44px"},{id:"size.target.compact",value:"24px"},{id:"size.target.natural",value:"32px"},{id:"space.inline.group",value:"8px"},{id:"space.inline.hairline",value:"2px"},{id:"space.inline.tight",value:"4px"},{id:"space.layout.page",value:"24px"},{id:"space.layout.panel",value:"12px"},{id:"space.stack.group",value:"8px"},{id:"space.stack.section",value:"12px"},{id:"space.stack.tight",value:"4px"},{id:"type.body.line",value:"20px"},{id:"type.body.size",value:"14px"},{id:"type.body.weight",value:"400"},{id:"type.caption.line",value:"16px"},{id:"type.caption.size",value:"12px"},{id:"type.caption.weight",value:"400"},{id:"type.heading.page.line",value:"32px"},{id:"type.heading.page.size",value:"24px"},{id:"type.heading.page.weight",value:"600"},{id:"type.heading.section.line",value:"24px"},{id:"type.heading.section.size",value:"18px"},{id:"type.heading.section.weight",value:"600"},{id:"type.label.line",value:"16px"},{id:"type.label.size",value:"13px"},{id:"type.label.weight",value:"500"},{id:"weight.light",value:"100"},{id:"weight.medium",value:"500"},{id:"weight.regular",value:"400"},{id:"weight.semibold",value:"600"},{id:"z-index.base",value:"0"},{id:"z-index.modal",value:"300"},{id:"z-index.overlay",value:"100"},{id:"z-index.popover",value:"200"},{id:"z-index.raised",value:"1"},{id:"z-index.sticky",value:"10"},{id:"z-index.toast",value:"400"}]}}});var Lp={};Ha(Lp,{violetThemeBuiltInSet:()=>Dn,violetThemeCssText:()=>kx,violetThemeDeclarations:()=>Cx,violetThemeDeclarationsByPreset:()=>Op});var kx,Op,Cx,Pp=yi(()=>{"use strict";Vp();aa();An();kx=In(Dn),Op=Object.fromEntries(Object.entries(Dn.presets).map(([t,e])=>[t,e.map(i=>`  ${$n(i.id)}: ${i.value};`).join(`
`)])),Cx=Op[mr]});var wf=If(()=>{(function(){"use strict";function t(m){var w=0;return function(){return w<m.length?{done:!1,value:m[w++]}:{done:!0}}}var e=typeof Object.defineProperties=="function"?Object.defineProperty:function(m,w,z){return m==Array.prototype||m==Object.prototype||(m[w]=z.value),m};function i(m){m=[typeof globalThis=="object"&&globalThis,m,typeof window=="object"&&window,typeof self=="object"&&self,typeof global=="object"&&global];for(var w=0;w<m.length;++w){var z=m[w];if(z&&z.Math==Math)return z}throw Error("Cannot find global object")}var o=i(this);function r(m,w){if(w)e:{var z=o;m=m.split(".");for(var E=0;E<m.length-1;E++){var C=m[E];if(!(C in z))break e;z=z[C]}m=m[m.length-1],E=z[m],w=w(E),w!=E&&w!=null&&e(z,m,{configurable:!0,writable:!0,value:w})}}r("Symbol",function(m){function w(C){if(this instanceof w)throw new TypeError("Symbol is not a constructor");return new z("jscomp_symbol_"+(C||"")+"_"+E++,C)}function z(C,j){this.l=C,e(this,"description",{configurable:!0,writable:!0,value:j})}if(m)return m;z.prototype.toString=function(){return this.l};var E=0;return w}),r("Symbol.iterator",function(m){if(m)return m;m=Symbol("Symbol.iterator");for(var w="Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array".split(" "),z=0;z<w.length;z++){var E=o[w[z]];typeof E=="function"&&typeof E.prototype[m]!="function"&&e(E.prototype,m,{configurable:!0,writable:!0,value:function(){return n(t(this))}})}return m});function n(m){return m={next:m},m[Symbol.iterator]=function(){return this},m}function s(m){var w=typeof Symbol<"u"&&Symbol.iterator&&m[Symbol.iterator];return w?w.call(m):{next:t(m)}}function a(m){if(!(m instanceof Array)){m=s(m);for(var w,z=[];!(w=m.next()).done;)z.push(w.value);m=z}return m}var l=typeof Object.create=="function"?Object.create:function(m){function w(){}return w.prototype=m,new w},d=(function(){function m(){function z(){}return new z,Reflect.construct(z,[],function(){}),new z instanceof z}if(typeof Reflect<"u"&&Reflect.construct){if(m())return Reflect.construct;var w=Reflect.construct;return function(z,E,C){return z=w(z,E),C&&Reflect.setPrototypeOf(z,C.prototype),z}}return function(z,E,C){return C===void 0&&(C=z),C=l(C.prototype||Object.prototype),Function.prototype.apply.call(z,C,E)||C}})(),u;if(typeof Object.setPrototypeOf=="function")u=Object.setPrototypeOf;else{var p;e:{var v={a:!0},k={};try{k.__proto__=v,p=k.a;break e}catch{}p=!1}u=p?function(m,w){if(m.__proto__=w,m.__proto__!==w)throw new TypeError(m+" is not extensible");return m}:null}var S=u,R=window,F;if(((F=R.CustomElementRegistryPolyfill)==null?void 0:F.formAssociated)===void 0){var _={};R.CustomElementRegistryPolyfill=(_.formAssociated=new Set,_)}var $=window.HTMLElement,D=window.customElements.define,O=window.customElements.get,L=window.customElements,P=new WeakMap,W=new WeakMap,ge=new WeakMap,Te=new WeakMap;function ut(){var m;this.promise=new Promise(function(w){m=w}),this.resolve=m}function Oe(){this.h=new Map,this.m=new Map,this.j=new Map,this.i=new Map}Oe.prototype.define=function(m,w){if(m=m.toLowerCase(),this.h.get(m)!==void 0)throw new DOMException(`Failed to execute 'define' on 'CustomElementRegistry': the name "`+m+'" has already been used with this registry');if(this.m.get(w)!==void 0)throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': this constructor has already been used with this registry");var z=w.prototype.attributeChangedCallback,E=new Set(w.observedAttributes||[]);Ro(w,E,z);var C=O.call(L,m),j,q,Ce=(q=(j=C)==null?void 0:j.s)!=null?q:w.formAssociated||R.CustomElementRegistryPolyfill.formAssociated.has(m);if(Ce&&R.CustomElementRegistryPolyfill.formAssociated.add(m),Ce!=w.formAssociated)try{w.formAssociated=Ce}catch{}if(z={tagName:m,g:w,connectedCallback:w.prototype.connectedCallback,disconnectedCallback:w.prototype.disconnectedCallback,adoptedCallback:w.prototype.adoptedCallback,attributeChangedCallback:z,formAssociated:Ce,formAssociatedCallback:w.prototype.formAssociatedCallback,formDisabledCallback:w.prototype.formDisabledCallback,formResetCallback:w.prototype.formResetCallback,formStateRestoreCallback:w.prototype.formStateRestoreCallback,observedAttributes:E},this.h.set(m,z),this.m.set(w,z),C||(C=ht(m),D.call(L,m,C)),this===window.customElements&&(ge.set(w,z),z.o=C),C=this.i.get(m))for(this.i.delete(m),C=s(C),E=C.next();!E.done;E=C.next())E=E.value,W.delete(E),Va(E,z,!0);return C=this.j.get(m),C!==void 0&&(C.resolve(w),this.j.delete(m)),w},Oe.prototype.upgrade=function(m){for(var w=[],z=0;z<arguments.length;++z)w[z]=arguments[z];Zt.push(this),L.upgrade.apply(L,a(w)),Zt.pop()},Oe.prototype.get=function(m){var w;return(w=this.h.get(m))==null?void 0:w.g},Oe.prototype.whenDefined=function(m){var w=this.h.get(m);return w!==void 0?Promise.resolve(w.g):(w=this.j.get(m),w===void 0&&(w=new ut,this.j.set(m,w)),w.promise)};function qe(m,w,z,E){var C=m.i.get(z);C||m.i.set(z,C=new Set),E?C.add(w):C.delete(w)}var Jt;window.HTMLElement=function(){var m=Jt;if(m)return Jt=void 0,m;var w=ge.get(this.constructor);if(!w)throw new TypeError("Illegal constructor (custom element class must be registered with global customElements registry to be newable)");return m=Reflect.construct($,[],w.o),Object.setPrototypeOf(m,this.constructor.prototype),P.set(m,w),m},window.HTMLElement.prototype=$.prototype;function ht(m){function w(){var z=Reflect.construct($,[],this.constructor);Object.setPrototypeOf(z,HTMLElement.prototype);e:{var E=z.getRootNode();if(!(E===document||E instanceof ShadowRoot)){if(E=Zt[Zt.length-1],E instanceof CustomElementRegistry){var C=E;break e}E=E.getRootNode(),E===document||E instanceof ShadowRoot||(E=((C=Te.get(E))==null?void 0:C.getRootNode())||document)}C=E.registry}return C=C||window.customElements,(E=C.h.get(m))?Va(z,E):W.set(z,C),z}return o.Object.defineProperty(w,"formAssociated",{configurable:!0,enumerable:!0,get:function(){return R.CustomElementRegistryPolyfill.formAssociated.has(m)}}),w.prototype.connectedCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];wr(this),(C=P.get(this))?C.connectedCallback&&C.connectedCallback.apply(this,E):qe(W.get(this),this,m,!0)},w.prototype.disconnectedCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];(C=P.get(this))?C.disconnectedCallback&&C.disconnectedCallback.apply(this,E):qe(W.get(this),this,m,!1)},w.prototype.adoptedCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];var j,q;(j=P.get(this))==null||(q=j.adoptedCallback)==null||q.apply(this,E)},w.prototype.formAssociatedCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];if(C=P.get(this),C!=null&&C.formAssociated){var j;C==null||(j=C.formAssociatedCallback)==null||j.apply(this,E)}},w.prototype.formDisabledCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];if(C=P.get(this),C!=null&&C.formAssociated){var j;C==null||(j=C.formDisabledCallback)==null||j.apply(this,E)}},w.prototype.formResetCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];if(C=P.get(this),C!=null&&C.formAssociated){var j;C==null||(j=C.formResetCallback)==null||j.apply(this,E)}},w.prototype.formStateRestoreCallback=function(z){for(var E=[],C=0;C<arguments.length;++C)E[C]=arguments[C];if(C=P.get(this),C!=null&&C.formAssociated){var j;C==null||(j=C.formStateRestoreCallback)==null||j.apply(this,E)}},w}window.CustomElementRegistry=Oe;function Ro(m,w,z){if(w.size!==0&&z!==void 0){var E=m.prototype.setAttribute;E&&(m.prototype.setAttribute=function(q,Ce){if(wr(this),q=q.toLowerCase(),w.has(q)){var Fo=this.getAttribute(q);E.call(this,q,Ce),z.call(this,q,Fo,Ce)}else E.call(this,q,Ce)});var C=m.prototype.removeAttribute;C&&(m.prototype.removeAttribute=function(q){if(wr(this),q=q.toLowerCase(),w.has(q)){var Ce=this.getAttribute(q);C.call(this,q),z.call(this,q,Ce,null)}else C.call(this,q)});var j=m.prototype.toggleAttribute;j&&(m.prototype.toggleAttribute=function(q,Ce){if(wr(this),q=q.toLowerCase(),w.has(q)){var Fo=this.getAttribute(q);j.call(this,q,Ce),Ce=this.getAttribute(q),Fo!==Ce&&z.call(this,q,Fo,Ce)}else j.call(this,q,Ce)})}}var Bi;document.readyState==="loading"&&(Bi=new Set,document.addEventListener("readystatechange",function(){Bi.forEach(function(m){return Pn(m,P.get(m))})},{once:!0}));function wr(m){var w;(w=Bi)!=null&&w.has(m)&&Pn(m,P.get(m))}function Pn(m,w){var z;(z=Bi)==null||z.delete(m),w.attributeChangedCallback&&w.observedAttributes.forEach(function(E){m.hasAttribute(E)&&w.attributeChangedCallback.call(m,E,null,m.getAttribute(E))})}function Ma(m){var w=Object.getPrototypeOf(m);if(w!==window.HTMLElement)return w===$?Object.setPrototypeOf(m,window.HTMLElement):Ma(w)}function Va(m,w,z){z=z===void 0?!1:z,Object.setPrototypeOf(m,w.g.prototype),P.set(m,w),Jt=m;try{new w.g}catch{Ma(w.g),new w.g}w.attributeChangedCallback&&(Bi===void 0||m.hasAttributes()?Pn(m,w):Bi.add(m)),z&&w.connectedCallback&&m.isConnected&&w.connectedCallback.call(m)}var Oa=Element.prototype.attachShadow;Element.prototype.attachShadow=function(m,w){for(var z=[],E=1;E<arguments.length;++E)z[E-1]=arguments[E];var C=Object.assign({},m);return E=m.customElements,E=m.registry===void 0?E:m.registry,C=(delete C.customElements,delete C.registry,C),z=Oa.call.apply(Oa,[this,C].concat(a(z))),E!==void 0&&(z.customElements=z.registry=E),z};var Zt=[document];function _r(m,w,z){var E=(z?Object.getPrototypeOf(z):m.prototype)[w];m.prototype[w]=function(C){for(var j=[],q=0;q<arguments.length;++q)j[q]=arguments[q];return Zt.push(this),j=E.apply(z||this,j),j!==void 0&&Te.set(j,this),Zt.pop(),j}}_r(ShadowRoot,"createElement",document),_r(ShadowRoot,"createElementNS",document),_r(ShadowRoot,"importNode",document),_r(Element,"insertAdjacentHTML");function La(m){var w=Object.getOwnPropertyDescriptor(m.prototype,"innerHTML");Object.defineProperty(m.prototype,"innerHTML",Object.assign({},w,{set:function(z){Zt.push(this),w.set.call(this,z),Zt.pop()}}))}if(La(Element),La(ShadowRoot),Object.defineProperty(window,"customElements",{value:new CustomElementRegistry,configurable:!0,writable:!0}),window.ElementInternals&&window.ElementInternals.prototype.setFormValue){var Pa=new WeakMap,Ba=HTMLElement.prototype.attachInternals,kf=["setFormValue","setValidity","checkValidity","reportValidity"];HTMLElement.prototype.attachInternals=function(m){for(var w=[],z=0;z<arguments.length;++z)w[z]=arguments[z];return w=Ba.call.apply(Ba,[this].concat(a(w))),Pa.set(w,this),w},kf.forEach(function(m){var w=window.ElementInternals.prototype,z=w[m];w[m]=function(E){for(var C=[],j=0;j<arguments.length;++j)C[j]=arguments[j];if(j=Pa.get(this),P.get(j).formAssociated===!0)return z?.call.apply(z,[this].concat(a(C)));throw new DOMException("Failed to execute "+z+" on 'ElementInternals': The target element is not a form-associated custom element.")}});var Bn=function(m){var w=d(Array,[].concat(a(m)),this.constructor);return w.l=m,w},bi=Bn,Ni=Array;if(bi.prototype=l(Ni.prototype),bi.prototype.constructor=bi,S)S(bi,Ni);else for(var Do in Ni)if(Do!="prototype")if(Object.defineProperties){var Na=Object.getOwnPropertyDescriptor(Ni,Do);Na&&Object.defineProperty(bi,Do,Na)}else bi[Do]=Ni[Do];bi.u=Ni.prototype,o.Object.defineProperty(Bn.prototype,"value",{configurable:!0,enumerable:!0,get:function(){var m;return((m=this.l.find(function(w){return w.checked===!0}))==null?void 0:m.value)||""}});var kr=function(m){var w=this,z=new Map;m.forEach(function(E,C){var j=E.getAttribute("name"),q=z.get(j)||[];w[+C]=E,q.push(E),z.set(j,q)}),this.length=m.length,z.forEach(function(E,C){E&&C!=="length"&&C!=="item"&&C!=="namedItem"&&(w[C]=E.length===1?E[0]:new Bn(E))})};kr.prototype.item=function(m){var w;return(w=this[m])!=null?w:null},kr.prototype[Symbol.iterator]=function(){throw Error("Method not implemented.")},kr.prototype.namedItem=function(m){var w;return(w=this[m])!=null?w:null};var Cf=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,"elements");Object.defineProperty(HTMLFormElement.prototype,"elements",{get:function(){var m=Cf.get.call(this),w=[];m=s(m);for(var z=m.next();!z.done;z=m.next()){z=z.value;var E=P.get(z);E&&E.formAssociated!==!0||w.push(z)}return new kr(w)}})}}).call(typeof globalThis=="object"?globalThis:window)});var Df=new WeakMap,ja=new WeakMap;function Hn(t){return Df.get(t)}function qa(t,e=customElements){var i;return(i=ja.get(e))===null||i===void 0?void 0:i.get(t)}function Wa(t=customElements){return ja.get(t)}function Ka(t,e=customElements){let i=qa(t,e);if(!i)return;let o=Hn(i);if(o)return Object.assign(Object.assign({},o),{name:t})}function Ua(t=customElements){let e=new Map,i=Wa(t);if(i)for(let[o,r]of i){let n=Hn(r);n&&e.set(o,Object.assign(Object.assign({},n),{name:o}))}return e}var ee;(function(t){t[t.needsArrayObservation=1101]="needsArrayObservation",t[t.onlySetDOMPolicyOnce=1201]="onlySetDOMPolicyOnce",t[t.bindingInnerHTMLRequiresTrustedTypes=1202]="bindingInnerHTMLRequiresTrustedTypes",t[t.twoWayBindingRequiresObservables=1203]="twoWayBindingRequiresObservables",t[t.hostBindingWithoutHost=1204]="hostBindingWithoutHost",t[t.unsupportedBindingBehavior=1205]="unsupportedBindingBehavior",t[t.directCallToHTMLTagNotAllowed=1206]="directCallToHTMLTagNotAllowed",t[t.onlySetTemplatePolicyOnce=1207]="onlySetTemplatePolicyOnce",t[t.cannotSetTemplatePolicyAfterCompilation=1208]="cannotSetTemplatePolicyAfterCompilation",t[t.blockedByDOMPolicy=1209]="blockedByDOMPolicy",t[t.invalidHydrationAttributeMarker=1210]="invalidHydrationAttributeMarker",t[t.duplicateRenderInstruction=1211]="duplicateRenderInstruction",t[t.missingElementDefinition=1401]="missingElementDefinition",t[t.noRegistrationForContext=1501]="noRegistrationForContext",t[t.noFactoryForResolver=1502]="noFactoryForResolver",t[t.invalidResolverStrategy=1503]="invalidResolverStrategy",t[t.cannotAutoregisterDependency=1504]="cannotAutoregisterDependency",t[t.cannotResolveKey=1505]="cannotResolveKey",t[t.cannotConstructNativeFunction=1506]="cannotConstructNativeFunction",t[t.cannotJITRegisterNonConstructor=1507]="cannotJITRegisterNonConstructor",t[t.cannotJITRegisterIntrinsic=1508]="cannotJITRegisterIntrinsic",t[t.cannotJITRegisterInterface=1509]="cannotJITRegisterInterface",t[t.invalidResolver=1510]="invalidResolver",t[t.invalidKey=1511]="invalidKey",t[t.noDefaultResolver=1512]="noDefaultResolver",t[t.cyclicDependency=1513]="cyclicDependency",t[t.connectUpdateRequiresController=1514]="connectUpdateRequiresController"})(ee||(ee={}));var ie=t=>typeof t=="function",be=t=>typeof t=="string",Ga=()=>{};var Ya=Object.create(null),oe={warn(t,e){},error(t,e){return new Error(`Error ${t}`)},addMessages(t){Object.assign(Ya,t)}};function Xa(){return Ya}var Hi=Object.freeze([]);function ji(){let t=new Map;return Object.freeze({register(e){return t.has(e.type)?!1:(t.set(e.type,e),!0)},getByType(e){return t.get(e)},getForInstance(e){if(e!=null)return t.get(e.constructor)}})}function Cr(){let t=new WeakMap;return function(e){let i=t.get(e);if(i===void 0){let o=Reflect.getPrototypeOf(e);for(;i===void 0&&o!==null;)i=t.get(o),o=Reflect.getPrototypeOf(o);i=i===void 0?[]:i.slice(0),t.set(e,i)}return i}}function Ae(t){t.prototype.toJSON=Ga}var ei=class{constructor(e,i){this.sub1=void 0,this.sub2=void 0,this.spillover=void 0,this.subject=e,this.sub1=i}has(e){return this.spillover===void 0?this.sub1===e||this.sub2===e:this.spillover.indexOf(e)!==-1}subscribe(e){let i=this.spillover;if(i===void 0){if(this.has(e))return;if(this.sub1===void 0){this.sub1=e;return}if(this.sub2===void 0){this.sub2=e;return}this.spillover=[this.sub1,this.sub2,e],this.sub1=void 0,this.sub2=void 0}else i.indexOf(e)===-1&&i.push(e)}unsubscribe(e){let i=this.spillover;if(i===void 0)this.sub1===e?this.sub1=void 0:this.sub2===e&&(this.sub2=void 0);else{let o=i.indexOf(e);o!==-1&&i.splice(o,1)}}notify(e){let i=this.spillover,o=this.subject;if(i===void 0){let r=this.sub1,n=this.sub2;r!==void 0&&r.handleChange(o,e),n!==void 0&&n.handleChange(o,e)}else for(let r=0,n=i.length;r<n;++r)i[r].handleChange(o,e)}},qi=class{constructor(e){this.subscribers={},this.subjectSubscribers=null,this.subject=e}notify(e){var i,o;(i=this.subscribers[e])===null||i===void 0||i.notify(e),(o=this.subjectSubscribers)===null||o===void 0||o.notify(e)}subscribe(e,i){var o,r;let n;i?n=(o=this.subscribers[i])!==null&&o!==void 0?o:this.subscribers[i]=new ei(this.subject):n=(r=this.subjectSubscribers)!==null&&r!==void 0?r:this.subjectSubscribers=new ei(this.subject),n.subscribe(e)}unsubscribe(e,i){var o,r;i?(o=this.subscribers[i])===null||o===void 0||o.unsubscribe(e):(r=this.subjectSubscribers)===null||r===void 0||r.unsubscribe(e)}};var pt=[],jn=[],Ff=globalThis.requestAnimationFrame,Wn=!0;function Mf(){if(jn.length)throw jn.shift()}function Vf(t){try{t.call()}catch(e){if(Wn)jn.push(e),setTimeout(Mf,0);else throw pt.length=0,e}}function qn(){let e=0;for(;e<pt.length;)if(Vf(pt[e]),e++,e>1024){for(let i=0,o=pt.length-e;i<o;i++)pt[i]=pt[i+e];pt.length-=e,e=0}pt.length=0}function Qa(t){pt.push(t),pt.length<2&&(Wn?Ff(qn):qn())}var M=Object.freeze({enqueue:Qa,next:()=>new Promise(Qa),process:qn,setMode:t=>Wn=t});var Ot=Object.freeze({unknown:void 0,coupled:1}),T=(()=>{let t=M.enqueue,e=/(:|&&|\|\||if|\?\.)/,i=new WeakMap,o,r=d=>{throw oe.error(ee.needsArrayObservation)};function n(d){var u;let p=(u=d.$fastController)!==null&&u!==void 0?u:i.get(d);return p===void 0&&(Array.isArray(d)?p=r(d):i.set(d,p=new qi(d))),p}let s=Cr();class a{constructor(u){this.name=u,this.field=`_${u}`,this.callback=`${u}Changed`}getValue(u){return o!==void 0&&o.watch(u,this.name),u[this.field]}setValue(u,p){let v=this.field,k=u[v];if(k!==p){u[v]=p;let S=u[this.callback];ie(S)&&S.call(u,k,p),n(u).notify(this.name)}}}class l extends ei{constructor(u,p,v=!1){super(u,p),this.expression=u,this.isVolatileBinding=v,this.needsRefresh=!0,this.needsQueue=!0,this.isAsync=!0,this.first=this,this.last=null,this.propertySource=void 0,this.propertyName=void 0,this.notifier=void 0,this.next=void 0}setMode(u){this.isAsync=this.needsQueue=u}bind(u){let p=this.observe(u.source,u.context);return!u.isBound&&this.requiresUnbind(u)&&u.onUnbind(this),p}requiresUnbind(u){return u.sourceLifetime!==Ot.coupled||this.first!==this.last||this.first.propertySource!==u.source}unbind(u){this.dispose()}observe(u,p){this.needsRefresh&&this.last!==null&&this.dispose();let v=o;o=this.needsRefresh?this:void 0,this.needsRefresh=this.isVolatileBinding;let k;try{k=this.expression(u,p)}finally{o=v}return k}disconnect(){this.dispose()}dispose(){if(this.last!==null){let u=this.first;for(;u!==void 0;)u.notifier.unsubscribe(this,u.propertyName),u=u.next;this.last=null,this.needsRefresh=!0,this.needsQueue=this.isAsync}}watch(u,p){let v=this.last,k=n(u),S=v===null?this.first:{};if(S.propertySource=u,S.propertyName=p,S.notifier=k,k.subscribe(this,p),v!==null){if(!this.needsRefresh){let R;o=void 0,R=v.propertySource[v.propertyName],o=this,u===R&&(this.needsRefresh=!0)}v.next=S}this.last=S}handleChange(){this.needsQueue?(this.needsQueue=!1,t(this)):this.isAsync||this.call()}call(){this.last!==null&&(this.needsQueue=this.isAsync,this.notify(this))}*records(){let u=this.first;for(;u!==void 0;)yield u,u=u.next}}return Ae(l),Object.freeze({setArrayObserverFactory(d){r=d},getNotifier:n,track(d,u){o&&o.watch(d,u)},trackVolatile(){o&&(o.needsRefresh=!0)},notify(d,u){n(d).notify(u)},defineProperty(d,u){be(u)&&(u=new a(u)),s(d).push(u),Reflect.defineProperty(d,u.name,{enumerable:!0,get(){return u.getValue(this)},set(p){u.setValue(this,p)}})},getAccessors:s,binding(d,u,p=this.isVolatileBinding(d)){return new l(d,u,p)},isVolatileBinding(d){return e.test(d.toString())}})})();function f(t,e){T.defineProperty(t,e)}var Ja=(()=>{let t=null;return{get(){return t},set(e){t=e}}})(),Lt=Object.freeze({default:{index:0,length:0,get event(){return Lt.getEvent()},eventDetail(){return this.event.detail},eventTarget(){return this.event.target}},getEvent(){return Ja.get()},setEvent(t){Ja.set(t)}});var Kn;function Za(t){return t.reduce((e,i)=>(i instanceof Re?e.push(...Za(i.styles)):e.push(i),e),[])}var Re=class t{get strategy(){return this._strategy===null&&(Kn||t.setDefaultStrategy(t.supportsAdoptedStyleSheets?Of():Pf()),this.withStrategy(Kn)),this._strategy}constructor(e){this.styles=e,this.targets=new WeakSet,this._strategy=null}addStylesTo(e){this.strategy.addStylesTo(e),this.targets.add(e)}removeStylesFrom(e){this.strategy.removeStylesFrom(e),this.targets.delete(e)}isAttachedTo(e){return this.targets.has(e)}withStrategy(e){return this._strategy=new e(Za(this.styles)),this}static setDefaultStrategy(e){Kn=e}static normalize(e){return e===void 0?void 0:Array.isArray(e)?new t(e):e instanceof t?e:new t([e])}};Re.supportsAdoptedStyleSheets=Array.isArray(document.adoptedStyleSheets)&&"replace"in CSSStyleSheet.prototype;function Of(){let t=new Map;return class{constructor(i){this.sheets=i.map(o=>{if(o instanceof CSSStyleSheet)return o;let r=t.get(o);return r===void 0&&(r=new CSSStyleSheet,r.replaceSync(o),t.set(o,r)),r})}addStylesTo(i){let o=i;o.adoptedStyleSheets=[...o.adoptedStyleSheets,...this.sheets]}removeStylesFrom(i){let o=i;o.adoptedStyleSheets=o.adoptedStyleSheets.filter(r=>this.sheets.indexOf(r)===-1)}}}var Lf=0;function Pf(){return class{constructor(e){this.styles=e,this.styleClass=`fast-${++Lf}`}addStylesTo(e){let i=e===document?document.body:e;for(let o=0;o<this.styles.length;o++){let r=document.createElement("style");r.innerHTML=this.styles[o],r.className=this.styleClass,i.append(r)}}removeStylesFrom(e){let i=e===document?document.body:e,o=i.querySelectorAll(`.${this.styleClass}`);for(let r=0,n=o.length;r<n;++r)i.removeChild(o[r])}}}var X=Object.freeze({none:0,attribute:1,booleanAttribute:2,property:3,content:4,tokenList:5,event:6});var Bf=/^[\u0000-\u0020\u007F]+|[\u0000-\u0020\u007F]+$/g,Nf=/[\u0000-\u0020\u007F]+/g,Hf=/^(?:javascript|vbscript|data):/;function Un(t){return t.replace(Bf,"")}function jf(t){try{return decodeURIComponent(t)}catch{return t}}function qf(t){let e=Un(t);for(let i=0;i<3;++i){let o=jf(e);if(o===e)break;e=Un(o)}return e=e.replace(Nf,"").toLowerCase(),Hf.test(e)}function Wf(t){let e=Un(t);return qf(e)?"":e}function Pt(t,e,i,o){return(r,n,s,...a)=>{s!=null&&(s=Wf(`${s}`)),o(r,n,s,...a)}}function I(t,e,i,o){throw oe.error(ee.blockedByDOMPolicy,{aspectName:i,tagName:t??"text"})}var Kf={"a.href":Pt,"area.href":Pt,"embed.src":I,"form.action":Pt,"frame.src":Pt,"iframe.src":Pt,"iframe.srcdoc":I,"link.href":I,"object.data":I,"script.src":I,"script.text":I},Uf={"button.formaction":Pt,"input.formaction":Pt,"object.codebase":I},Gf={"button.formAction":Pt,"input.formAction":Pt,"object.codeBase":I,"script.innerText":I,"script.textContent":I,"style.innerText":I,"style.textContent":I};function Yf(t,e,i){var o;let r=e===X.attribute?Uf:e===X.property?Gf:void 0;if(r){let n=`${t}.${i}`;return(o=r[n])!==null&&o!==void 0?o:Kf[n]}}var Xf={onabort:I,onauxclick:I,onbeforeinput:I,onbeforematch:I,onblur:I,oncancel:I,oncanplay:I,oncanplaythrough:I,onchange:I,onclick:I,onclose:I,oncontextlost:I,oncontextmenu:I,oncontextrestored:I,oncopy:I,oncuechange:I,oncut:I,ondblclick:I,ondrag:I,ondragend:I,ondragenter:I,ondragleave:I,ondragover:I,ondragstart:I,ondrop:I,ondurationchange:I,onemptied:I,onended:I,onerror:I,onfocus:I,onformdata:I,oninput:I,oninvalid:I,onkeydown:I,onkeypress:I,onkeyup:I,onload:I,onloadeddata:I,onloadedmetadata:I,onloadstart:I,onmousedown:I,onmouseenter:I,onmouseleave:I,onmousemove:I,onmouseout:I,onmouseover:I,onmouseup:I,onpaste:I,onpause:I,onplay:I,onplaying:I,onprogress:I,onratechange:I,onreset:I,onresize:I,onscroll:I,onsecuritypolicyviolation:I,onseeked:I,onseeking:I,onselect:I,onslotchange:I,onstalled:I,onsubmit:I,onsuspend:I,ontimeupdate:I,ontoggle:I,onvolumechange:I,onwaiting:I,onwebkitanimationend:I,onwebkitanimationiteration:I,onwebkitanimationstart:I,onwebkittransitionend:I,onwheel:I};function Qf(t,e){if(t===X.property&&e==="innerHTML")return I;if(t===X.attribute||t===X.property||t===X.event)return Xf[e]}function el(t,e,i,o){var r;let n=(r=Yf((t??"").toLowerCase(),e,i))!==null&&r!==void 0?r:Qf(e,i);return n?n(t,e,i,o):o}var tl=t=>t,Jf=globalThis.trustedTypes?globalThis.trustedTypes.createPolicy("fast-html",{createHTML:tl}):{createHTML:tl},il=Object.freeze({createHTML(t){return Jf.createHTML(t)},protect:el}),Gn=il,Bt=Object.freeze({get policy(){return Gn},setPolicy(t){if(Gn!==il)throw oe.error(ee.onlySetDOMPolicyOnce);Gn=t},setAttribute(t,e,i){i==null?t.removeAttribute(e):t.setAttribute(e,i)},setBooleanAttribute(t,e,i){i?t.setAttribute(e,""):t.removeAttribute(e)}});var Yn="boolean",ol="reflect",Xn=Object.freeze({locate:Cr()}),nl={toView(t){return t?"":null},fromView(t){return!!t}};function rl(t){if(t==null)return null;let e=t*1;return isNaN(e)?null:e}var Sr={toView(t){let e=rl(t);return e&&e.toString()},fromView:rl},Mo=class t{constructor(e,i,o=i.toLowerCase(),r=ol,n){this.guards=new Set,this.Owner=e,this.name=i,this.attribute=o,this.mode=r,this.converter=n,this.fieldName=`_${i}`,this.callbackName=`${i}Changed`,this.hasCallback=this.callbackName in e.prototype,r===Yn&&n===void 0&&(this.converter=nl)}setValue(e,i){let o=e[this.fieldName],r=this.converter;r!==void 0&&(i=r.fromView(i)),o!==i&&(e[this.fieldName]=i,this.tryReflectToAttribute(e),this.hasCallback&&e[this.callbackName](o,i),e.$fastController.notify(this.name))}getValue(e){return T.track(e,this.name),e[this.fieldName]}onAttributeChangedCallback(e,i){this.guards.has(e)||(this.guards.add(e),this.mode===Yn?this.setValue(e,i!==null):this.setValue(e,i),this.guards.delete(e))}tryReflectToAttribute(e){let i=this.mode,o=this.guards;o.has(e)||i==="fromView"||M.enqueue(()=>{o.add(e);let r=e[this.fieldName];switch(i){case ol:{let n=this.converter;Bt.setAttribute(e,this.attribute,n!==void 0?n.toView(r):r);break}case Yn:Bt.setBooleanAttribute(e,this.attribute,r);break}o.delete(e)})}static collect(e,...i){let o=[];i.push(Xn.locate(e));for(let r=0,n=i.length;r<n;++r){let s=i[r];if(s!==void 0)for(let a=0,l=s.length;a<l;++a){let d=s[a];be(d)?o.push(new t(e,d)):o.push(new t(e,d.property,d.attribute,d.mode,d.converter))}}return o}};function c(t,e){let i;function o(r,n){arguments.length>1&&(i.property=n),Xn.locate(r.constructor).push(i)}if(arguments.length>1){i={},o(t,e);return}return i=t===void 0?{}:t,o}var Qn={define(t,e,i,o,r){o.define(t,e,i)}};var Zf={},sl=new WeakMap,Jn=ji(),zr=new WeakMap,al=new WeakMap,Wi=Object.freeze({register(t){if(!Jn.register(t))return!1;let e=cl(t.registry);return Object.prototype.hasOwnProperty.call(e,t.name)||T.defineProperty(e,t.name),e[t.name]=t.type,!0},getByType:Jn.getByType,getForInstance:Jn.getForInstance,whenRegistered:em});function cl(t=customElements){if(t===customElements)return Zf;let e=sl.get(t);return e||(e={},sl.set(t,e)),e}function ll(t){return t===void 0?void 0:Wi.getByType(t)}function em(t,e=customElements){let i=cl(e);Object.prototype.hasOwnProperty.call(i,t)||T.defineProperty(i,t);let o=ll(i[t]);return o!==void 0?Promise.resolve(o):new Promise(r=>{let n=T.getNotifier(i),s={handleChange:()=>{let a=ll(i[t]);a!==void 0&&(n.unsubscribe(s,t),r(a))}};n.subscribe(s,t)})}function dl(t,e){if(al.has(e))return!1;let i=zr.get(t),o=i===void 0;i===void 0&&(i=new Set,zr.set(t,i));let r=new WeakRef(e);return i.add(r),al.set(e,r),o}function ul(t,e){let i=zr.get(t);if(i!==void 0){zr.delete(t);for(let o of i){let r=o.deref();r!==void 0&&e(r)}}}var tm={mode:"open"},hl={},pl=new Set;function im(t){if(t===null)return;let e=Object.assign(Object.assign({},tm),t);return e.customElementRegistry===void 0&&e.registry!==void 0&&(e.customElementRegistry=e.registry),e.registry===void 0&&e.customElementRegistry!==void 0&&(e.registry=e.customElementRegistry),e}var Tr=new WeakMap,Er=new WeakMap,xi=new WeakMap,fl=new WeakMap,Zn=new Set,om=new WeakMap;function rm(t){return ie(t)}function nm(t){return typeof t?.then=="function"}function ml(t,e){if(Er.delete(t),t.template===void 0&&e!==void 0&&(t.template=e),t.template!==void 0)return xi.delete(t),Tr.delete(t),t.template}function es(t,e=t.registry,i){if(Zn.size===0&&!i?.length)return;let o=t,r=fl.get(o);if(!r?.has(e)){r===void 0&&(r=new WeakSet,fl.set(o,r)),r.add(e);for(let n of Zn)n(t,e);for(let n of i??[])Zn.has(n)||n(t,e)}}function $r(t){var e;return(e=om.get(t))!==null&&e!==void 0?e:null}function ts(t){if(t.template!==void 0)return xi.delete(t),t.template;let e=Er.get(t);if(e)return e;let i=Tr.get(t);if(!i)return;xi.delete(t);let o;try{o=i(t)}catch(r){throw xi.set(t,r),r}if(nm(o)){let r=Promise.resolve(o).then(n=>ml(t,n)).catch(n=>{throw Er.delete(t),xi.set(t,n),n});return Er.set(t,r),r}return ml(t,o)}function sm(t,e){let i=t;if(e===void 0){xi.delete(i);return}xi.set(i,e)}var ye=class t{get isDefined(){return this.platformDefined}constructor(e,i=e.definition){var o;this.platformDefined=!1,be(i)&&(i={name:i}),this.type=e,this.name=i.name,this.registry=(o=i.registry)!==null&&o!==void 0?o:customElements,rm(i.template)?Tr.set(this,i.template):this.template=i.template;let r=e.prototype,n=Mo.collect(e,i.attributes),s=new Array(n.length),a={},l={};for(let d=0,u=n.length;d<u;++d){let p=n[d];s[d]=p.attribute,a[p.name]=p,l[p.attribute]=p,T.defineProperty(r,p)}Reflect.defineProperty(e,"observedAttributes",{value:s,enumerable:!0}),this.attributes=n,this.propertyLookup=a,this.attributeLookup=l,this.shadowOptions=im(i.shadowOptions),this.elementOptions=i.elementOptions===void 0?hl:Object.assign(Object.assign({},hl),i.elementOptions),this.styles=Re.normalize(i.styles),this.schema=i.schema,Wi.register(this)}define(e=this.registry,i){let o=this.type;if(!e.get(this.name)){if(es(this,e,i),this.template===void 0&&Tr.has(this))return Promise.resolve().then(()=>ts(this)).then(n=>{if(n!==void 0&&!e.get(this.name)){let s=this.platformDefined;this.platformDefined=!0,Qn.define(this.name,o,this.elementOptions,e,s)}}).catch(n=>{sm(this,n),T.notify(this,"template")}),this;let r=this.platformDefined;this.platformDefined=!0,Qn.define(this.name,o,this.elementOptions,e,r)}return this}static compose(e,i){let o=pl.has(e)||Wi.getByType(e)?new t(class extends e{},i):new t(e,i);return Promise.resolve(o)}static registerBaseType(e){pl.add(e)}};ye.getByType=Wi.getByType;ye.getForInstance=Wi.getForInstance;T.defineProperty(ye.prototype,"template");var is=new Map,os={names:0};function am(){os.names+=1,T.notify(os,"names")}function K(t){let e=is.get(t.name);return is.set(t.name,t),e?.svg!==t.svg&&am(),t}function vl(t){return T.track(os,"names"),is.get(t)??null}var lm={name:"system/arrow-up",sourceId:"system",originalFile:"arrow-up.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.5 L12 4.5"/><path d="M5.5 11 L12 4.5 L18.5 11"/></svg>'};function gl(){return K(lm)}var cm={name:"system/attach",sourceId:"system",originalFile:"attach.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9.71 6.72 L5.37 11.89 A4.25 4.25 0 0 0 11.88 17.35 L19.35 8.45 A2.13 2.13 0 0 0 16.1 5.72 L8.79 14.43"/></svg>'};function Ir(){return K(cm)}var dm={name:"system/calendar",sourceId:"system",originalFile:"calendar.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.9 7.35 A2.25 2.25 0 0 1 6.15 5.1 L17.85 5.1 A2.25 2.25 0 0 1 20.1 7.35 L20.1 18.35 A2.25 2.25 0 0 1 17.85 20.6 L6.15 20.6 A2.25 2.25 0 0 1 3.9 18.35 Z"/><path d="M3.9 10 L20.1 10"/><path d="M8.5 3 L8.5 7"/><path d="M15.5 3 L15.5 7"/><circle cx="15.25" cy="15.25" r="1.4" fill="currentColor" stroke="none"/></svg>'};function Ar(){return K(dm)}var um={name:"system/checkmark",sourceId:"system",originalFile:"checkmark.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5"/></svg>'};function ti(){return K(um)}var hm={name:"system/chevron-right",sourceId:"system",originalFile:"chevron-right.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9.25 5.25 L15.75 12 L9.25 18.75"/></svg>'};function ft(){return K(hm)}var pm={name:"system/clock",sourceId:"system",originalFile:"clock.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.1"/><path d="M12 6.75 V12 L15.75 14.25"/></svg>'};function bl(){return K(pm)}var fm={name:"system/close",sourceId:"system",originalFile:"close.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 5.5 L18.5 18.5"/><path d="M18.5 5.5 L5.5 18.5"/></svg>'};function mt(){return K(fm)}var mm={name:"system/dismiss",sourceId:"system",originalFile:"dismiss.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6.75 6.75 L17.25 17.25"/><path d="M17.25 6.75 L6.75 17.25"/></svg>'};function We(){return K(mm)}var vm={name:"system/document",sourceId:"system",originalFile:"document.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 4.9 A2 2 0 0 1 6.9 2.9 L12.92 2.9 A2 2 0 0 1 14.34 3.49 L18.51 7.66 A2 2 0 0 1 19.1 9.08 L19.1 19.1 A2 2 0 0 1 17.1 21.1 L6.9 21.1 A2 2 0 0 1 4.9 19.1 Z"/><path d="M8.5 12.5 L15.5 12.5"/><path d="M8.5 16.5 L12.5 16.5"/></svg>'};function ii(){return K(vm)}var gm={name:"system/folder",sourceId:"system",originalFile:"folder.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.9 6.4 A2 2 0 0 1 4.9 4.4 L8.5 4.4 A2 2 0 0 1 10 5.08 L11 6.22 A2 2 0 0 0 12.5 6.9 L19.1 6.9 A2 2 0 0 1 21.1 8.9 L21.1 17.6 A2 2 0 0 1 19.1 19.6 L4.9 19.6 A2 2 0 0 1 2.9 17.6 Z"/></svg>'};function yl(){return K(gm)}var bm={name:"system/settings",sourceId:"system",originalFile:"settings.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 5.57 L10.5 3.1 L13.5 3.1 L13.5 5.57 A6.6 6.6 0 0 1 16.82 7.49 L18.96 6.25 L20.46 8.85 L18.32 10.09 A6.6 6.6 0 0 1 18.32 13.91 L20.46 15.15 L18.96 17.75 L16.82 16.51 A6.6 6.6 0 0 1 13.5 18.43 L13.5 20.9 L10.5 20.9 L10.5 18.43 A6.6 6.6 0 0 1 7.18 16.51 L5.04 17.75 L3.54 15.15 L5.68 13.91 A6.6 6.6 0 0 1 5.68 10.09 L3.54 8.85 L5.04 6.25 L7.18 7.49 A6.6 6.6 0 0 1 10.5 5.57 Z"/><circle cx="12" cy="12" r="2.6"/></svg>'};function xl(){return K(bm)}var ym={name:"system/sort-ascending",sourceId:"system",originalFile:"sort-ascending.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18 L12 6"/><path d="M8 10 L12 6 L16 10"/></svg>'};function wl(){return K(ym)}var xm={name:"system/sort-descending",sourceId:"system",originalFile:"sort-descending.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6 L12 18"/><path d="M8 14 L12 18 L16 14"/></svg>'};function _l(){return K(xm)}var wm={name:"system/stop",sourceId:"system",originalFile:"stop.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5 A2.5 2.5 0 0 1 8.5 6 L15.5 6 A2.5 2.5 0 0 1 18 8.5 L18 15.5 A2.5 2.5 0 0 1 15.5 18 L8.5 18 A2.5 2.5 0 0 1 6 15.5 Z" fill="currentColor" stroke="none"/></svg>'};function kl(){return K(wm)}var _m={name:"system/warning",sourceId:"system",originalFile:"warning.svg",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.25 6.73 A2 2 0 0 1 13.75 6.73 L19.44 16.93 A2 2 0 0 1 17.69 19.9 L6.31 19.9 A2 2 0 0 1 4.56 16.93 Z"/><path d="M12 9.5 L12 13.5"/><circle cx="12" cy="16.6" r="1.1" fill="currentColor" stroke="none"/></svg>'};function Ki(){return K(_m)}var Ke=class{constructor(e,i,o=!1){this.evaluate=e,this.policy=i,this.isVolatile=o}};var Rr=class extends Ke{createObserver(){return this}bind(e){return this.evaluate(e.source,e.context)}};Ae(Rr);function it(t,e){return new Rr(t,e)}var rs=class extends Ke{createObserver(e){return T.binding(this.evaluate,e,this.isVolatile)}};function oi(t,e,i=T.isVolatileBinding(t)){return new rs(t,e,i)}function Vo(t){return ie(t)?oi(t):t instanceof Ke?t:it(()=>t)}var km={bubbles:!0,composed:!0,cancelable:!0},ns="isConnected",zl=new WeakMap,ss=Symbol("fast-late-attribute-observer");function Dr(t){var e,i;return(i=(e=t.shadowRoot)!==null&&e!==void 0?e:zl.get(t))!==null&&i!==void 0?i:null}var Cl,U;(function(t){t[t.connecting=0]="connecting",t[t.connected=1]="connected",t[t.disconnecting=2]="disconnecting",t[t.disconnected=3]="disconnected"})(U||(U={}));var ri=class t{get isConnected(){return T.track(this,ns),this.stage===U.connected}get context(){var e,i;return(i=(e=this.view)===null||e===void 0?void 0:e.context)!==null&&i!==void 0?i:Lt.default}get isBound(){var e,i;return(i=(e=this.view)===null||e===void 0?void 0:e.isBound)!==null&&i!==void 0?i:!1}get sourceLifetime(){var e;return(e=this.view)===null||e===void 0?void 0:e.sourceLifetime}get template(){var e;if(this._template===null){let i=this.definition;this.source.resolveTemplate?this._template=this.source.resolveTemplate():i.template&&(this._template=(e=i.template)!==null&&e!==void 0?e:null)}return this._template}set template(e){this._template!==e&&(this._template=e,this.needsInitialization||this.renderTemplate(e))}get shadowOptions(){return this._shadowRootOptions}set shadowOptions(e){if(this._shadowRootOptions===void 0&&e!==void 0){this._shadowRootOptions=e;let i=this.source.shadowRoot;i?(this.hasExistingShadowRoot=!0,Cm(i,e)):(i=this.source.attachShadow(e),e.mode==="closed"&&zl.set(this.source,i))}}get mainStyles(){var e;if(this._mainStyles===null){let i=this.definition;this.source.resolveStyles?this._mainStyles=this.source.resolveStyles():i.styles&&(this._mainStyles=(e=i.styles)!==null&&e!==void 0?e:null)}return this._mainStyles}set mainStyles(e){this._mainStyles!==e&&(this._mainStyles!==null&&this.removeStyles(this._mainStyles),this._mainStyles=e,this.needsInitialization||this.addStyles(e))}constructor(e,i){var o;this.boundObservables=null,this.needsInitialization=!0,this.hasExistingShadowRoot=!1,this.isPrerendered=new Promise(a=>{this._resolvePrerendered=a}),this.isHydrated=new Promise(a=>{this._resolveHydrated=a}),this._template=null,this.stage=U.disconnected,this.guardBehaviorConnection=!1,this.behaviors=null,this.behaviorsConnected=!1,this.connectedBehaviors=null,this._mainStyles=null,this.$fastController=this,this.view=null;let r=e.$fastController;this._notifier=(o=r?._notifier)!==null&&o!==void 0?o:new qi(e),this.source=e,this.definition=i,this.shadowOptions=i.shadowOptions;let n=Reflect.getPrototypeOf(e),s=n===null?[]:T.getAccessors(n);if(s.length>0){let a=this.boundObservables=Object.create(null);for(let l=0,d=s.length;l<d;++l){let u=s[l].name,p=e[u];p!==void 0&&(delete e[u],a[u]=p)}Object.keys(a).length===0&&(this.boundObservables=null)}this.captureBoundObservables()}get subject(){return this._notifier.subject}notify(e){this._notifier.notify(e)}subscribe(e,i){this._notifier.subscribe(e,i)}unsubscribe(e,i){this._notifier.unsubscribe(e,i)}onUnbind(e){var i;(i=this.view)===null||i===void 0||i.onUnbind(e)}addBehavior(e){var i,o,r;let n=(i=this.behaviors)!==null&&i!==void 0?i:this.behaviors=new Map,s=(o=n.get(e))!==null&&o!==void 0?o:0;s===0?(n.set(e,1),e.addedCallback&&e.addedCallback(this),n.has(e)&&!this.guardBehaviorConnection&&(this.stage===U.connected||this.stage===U.connecting)&&(((r=this.connectedBehaviors)!==null&&r!==void 0?r:this.connectedBehaviors=new Set).add(e),e.connectedCallback&&e.connectedCallback(this))):n.set(e,s+1)}removeBehavior(e,i=!1){var o,r;let n=this.behaviors;if(n===null)return;let s=n.get(e);if(s!==void 0)if(s===1||i){n.delete(e);let a=(r=(o=this.connectedBehaviors)===null||o===void 0?void 0:o.delete(e))!==null&&r!==void 0?r:!1;e.disconnectedCallback&&a&&e.disconnectedCallback(this),e.removedCallback&&e.removedCallback(this)}else n.set(e,s-1)}addStyles(e){var i;if(!e)return;let o=this.source;e instanceof HTMLElement?((i=Dr(o))!==null&&i!==void 0?i:this.source).append(e):e.isAttachedTo(o)||e.addStylesTo(o)}removeStyles(e){var i;if(!e)return;let o=this.source;e instanceof HTMLElement?((i=Dr(o))!==null&&i!==void 0?i:o).removeChild(e):e.isAttachedTo(o)&&e.removeStylesFrom(o)}connect(){if(this.stage===U.disconnected&&(this.stage=U.connecting,this.captureBoundObservables(),this.stage===U.connecting&&(this.syncLateAttributes(),this.stage===U.connecting&&(this.observeLateAttributes(),this.bindObservables(),this.stage===U.connecting&&(this.connectBehaviors(),this.stage===U.connecting))))){if(this.needsInitialization){let e=this.template;if(this.stage!==U.connecting)return;if(this.renderTemplate(e),this.stage!==U.connecting){this.view!==null&&(this.view.unbind(),this.view=null);return}let i=this.mainStyles;if(this.stage!==U.connecting)return;this.addStyles(i),this.needsInitialization=!1}else if(this.view!==null&&(this.view.bind(this.source),this.stage!==U.connecting)){this.view.unbind();return}this.stage=U.connected,T.notify(this,ns)}}bindObservables(){if(this.boundObservables!==null){let e=this.source,i=this.boundObservables,o=Object.keys(i);for(let r=0,n=o.length;r<n;++r){let s=o[r];e[s]=i[s]}this.boundObservables=null}}captureBoundObservables(){let e=this.source,i=Object.getOwnPropertyNames(e),o=n=>{let s=Reflect.getPrototypeOf(e);for(;s!==null;){let a=Reflect.getOwnPropertyDescriptor(s,n);if(a?.get||a?.set)return!0;s=Reflect.getPrototypeOf(s)}return!1},r=this.boundObservables;for(let n=0,s=i.length;n<s;++n){let l=i[n];if(!o(l))continue;let d=e[l];if(d===void 0){delete e[l];continue}delete e[l],(r??(r=this.boundObservables=Object.create(null)))[l]=d}}syncLateAttributes(){let e=$r(this.definition);if(e!==null)for(let i of Object.keys(e))this.source.hasAttribute(i)&&this.onAttributeChangedCallback(i,null,this.source.getAttribute(i))}observeLateAttributes(){let e=$r(this.definition);if(e===null)return;let i=this.source;i[ss]===void 0&&(i[ss]=new MutationObserver(o=>{let r=i.$fastController,n=$r(r.definition);if(n!==null)for(let s=0,a=o.length;s<a;++s){let l=o[s].attributeName;l===null||n[l]===void 0||r.onAttributeChangedCallback(l,null,i.getAttribute(l))}}),i[ss].observe(i,{attributes:!0,attributeFilter:Object.keys(e)}))}connectBehaviors(){var e;if(this.behaviorsConnected===!1){let i=this.behaviors;if(i!==null){let o=(e=this.connectedBehaviors)!==null&&e!==void 0?e:this.connectedBehaviors=new Set;this.guardBehaviorConnection=!0;try{for(let r of i.keys()){if(this.stage!==U.connecting)return;o.has(r)||(o.add(r),r.connectedCallback&&r.connectedCallback(this))}}finally{this.guardBehaviorConnection=!1}}this.stage===U.connecting&&(this.behaviorsConnected=!0)}}disconnectBehaviors(){let e=this.connectedBehaviors;if(e!==null)for(let i of e)e.delete(i),i.disconnectedCallback&&i.disconnectedCallback(this);this.behaviorsConnected=!1}disconnect(){if(this.stage!==U.connected&&this.stage!==U.connecting)return;let e=this.stage===U.connected;this.stage=U.disconnecting,e&&T.notify(this,ns),this.view!==null&&this.view.unbind(),this.disconnectBehaviors(),this.stage=U.disconnected}onAttributeChangedCallback(e,i,o){let r=this.definition.attributeLookup[e];r!==void 0&&r.onAttributeChangedCallback(this.source,o)}emit(e,i,o){return this.stage===U.connected?this.source.dispatchEvent(new CustomEvent(e,Object.assign(Object.assign({detail:i},km),o))):!1}renderTemplate(e){var i;let o=this.source,r=(i=Dr(o))!==null&&i!==void 0?i:o;if(this.view!==null)this.view.dispose(),this.view=null;else if((!this.needsInitialization||this.hasExistingShadowRoot)&&(!this.hasExistingShadowRoot||!this.needsInitialization))for(let n=r.firstChild;n!==null;n=r.firstChild)r.removeChild(n);if(e){let n=this.hasExistingShadowRoot&&this.needsInitialization,s=!1;n&&t.hydrationHook&&(s=t.hydrationHook(this,e,o,r)),s||this.renderClientSide(e,o,r),this._resolvePrerendered(n),this._resolveHydrated(s)}else this.needsInitialization&&(this._resolvePrerendered(!1),this._resolveHydrated(!1))}renderClientSide(e,i,o){var r;if(this.hasExistingShadowRoot){for(let l=o.firstChild;l!==null;l=o.firstChild)o.removeChild(l);this.hasExistingShadowRoot=!1}let n=((r=this._shadowRootOptions)===null||r===void 0?void 0:r.customElementRegistry)!==void 0?o:void 0,s=this.stage,a=e.render(i,o,i,n);if((s===U.connecting||s===U.connected)&&this.stage!==s){if(s===U.connected&&i.$fastController===this){a.unbind(),this.view=a,this.view.sourceLifetime=Ot.coupled;return}let l=a.firstChild,d=a.lastChild;l!=null&&l.parentNode===o&&d!=null&&d.parentNode===o?a.dispose():a.unbind();return}this.view=a,this.view.sourceLifetime=Ot.coupled}static forCustomElement(e,i=!1){let o=e.$fastController;if(o!==void 0&&!i)return o;let r=ye.getForInstance(e);if(r===void 0)throw oe.error(ee.missingElementDefinition);if(r.template===void 0&&dl(r,e)){let n=T.getNotifier(r),s={handleChange:()=>{n.unsubscribe(s,"template"),ul(r,a=>{var l;let d=a;(l=d.$fastController)===null||l===void 0||l.disconnect(),t.forCustomElement(d,!0),d.isConnected&&d.$fastController.connect()})}};n.subscribe(s,"template")}return e.$fastController=new Cl(e,r)}static setStrategy(e){Cl=e}static installHydrationHook(e){t.hydrationHook=e}};ri.hydrationHook=null;Ae(ri);function Cm(t,e){let i=e.customElementRegistry;i!=null&&t.customElementRegistry===null&&typeof i.initialize=="function"&&i.initialize(t)}ri.setStrategy(ri);function Fr(t){var e;return"adoptedStyleSheets"in t?t:(e=Dr(t))!==null&&e!==void 0?e:t.getRootNode()}var Mr=class t{constructor(e){let i=t.styleSheetCache;this.sheets=e.map(o=>{if(o instanceof CSSStyleSheet)return o;let r=i.get(o);return r===void 0&&(r=new CSSStyleSheet,r.replaceSync(o),i.set(o,r)),r})}addStylesTo(e){El(Fr(e),this.sheets)}removeStylesFrom(e){Tl(Fr(e),this.sheets)}};Mr.styleSheetCache=new Map;var Sm=0,zm=()=>`fast-${++Sm}`;function Sl(t){return t===document?document.body:t}var as=class{constructor(e){this.styles=e,this.styleClass=zm()}addStylesTo(e){e=Sl(Fr(e));let i=this.styles,o=this.styleClass;for(let r=0;r<i.length;r++){let n=document.createElement("style");n.innerHTML=i[r],n.className=o,e.append(n)}}removeStylesFrom(e){e=Sl(Fr(e));let i=e.querySelectorAll(`.${this.styleClass}`);for(let o=0,r=i.length;o<r;++o)e.removeChild(i[o])}},El=(t,e)=>{t.adoptedStyleSheets=[...t.adoptedStyleSheets,...e]},Tl=(t,e)=>{t.adoptedStyleSheets=t.adoptedStyleSheets.filter(i=>e.indexOf(i)===-1)};if(Re.supportsAdoptedStyleSheets){try{document.adoptedStyleSheets.push(),document.adoptedStyleSheets.splice(),El=(t,e)=>{t.adoptedStyleSheets.push(...e)},Tl=(t,e)=>{for(let i of e){let o=t.adoptedStyleSheets.indexOf(i);o!==-1&&t.adoptedStyleSheets.splice(o,1)}}}catch{}Re.setDefaultStrategy(Mr)}else Re.setDefaultStrategy(as);function $l(t){let e=class extends t{constructor(){super(),ri.forCustomElement(this)}$emit(i,o,r){return this.$fastController.emit(i,o,r)}connectedCallback(){this.$fastController.connect()}disconnectedCallback(){this.$fastController.disconnect()}attributeChangedCallback(i,o,r){this.$fastController.onAttributeChangedCallback(i,o,r)}};return ye.registerBaseType(e),e}function Em(t){return typeof t?.then=="function"}function Tm(t,e,i){return Array.isArray(e)&&(i=e,e=void 0),(ie(t)?ye.compose(t,e):ye.compose(this,t)).then(r=>{es(r,r.registry,i);let n=ts(r);return Em(n)?n.then(()=>r.define().type):r.define().type})}function $m(t){return $l(t)}var y=Object.assign($l(HTMLElement),{from:$m,define:Tm});var Le=class{constructor(e,i,o){this.index=e,this.removed=i,this.addedCount=o}adjustTo(e){let i=this.index,o=e.length;return i>o?i=o-this.addedCount:i<0&&(i=o+this.removed.length+i-this.addedCount),this.index=i<0?0:i,this}},Vr=class{constructor(e){this.sorted=e}},Im=Object.freeze({reset:1,splice:2,optimized:3}),Al=new Le(0,Hi,0);Al.reset=!0;var ds=[Al],Ue;(function(t){t[t.leave=0]="leave",t[t.update=1]="update",t[t.add=2]="add",t[t.delete=3]="delete"})(Ue||(Ue={}));function Am(t,e,i,o,r,n){let s=n-r+1,a=i-e+1,l=new Array(s),d,u;for(let p=0;p<s;++p)l[p]=new Array(a),l[p][0]=p;for(let p=0;p<a;++p)l[0][p]=p;for(let p=1;p<s;++p)for(let v=1;v<a;++v)t[e+v-1]===o[r+p-1]?l[p][v]=l[p-1][v-1]:(d=l[p-1][v]+1,u=l[p][v-1]+1,l[p][v]=d<u?d:u);return l}function Rm(t){let e=t.length-1,i=t[0].length-1,o=t[e][i],r=[];for(;e>0||i>0;){if(e===0){r.push(Ue.add),i--;continue}if(i===0){r.push(Ue.delete),e--;continue}let n=t[e-1][i-1],s=t[e-1][i],a=t[e][i-1],l;s<a?l=s<n?s:n:l=a<n?a:n,l===n?(n===o?r.push(Ue.leave):(r.push(Ue.update),o=n),e--,i--):l===s?(r.push(Ue.delete),e--,o=s):(r.push(Ue.add),i--,o=a)}return r.reverse()}function Dm(t,e,i){for(let o=0;o<i;++o)if(t[o]!==e[o])return o;return i}function Fm(t,e,i){let o=t.length,r=e.length,n=0;for(;n<i&&t[--o]===e[--r];)n++;return n}function Mm(t,e,i,o){return e<i||o<t?-1:e===i||o===t?0:t<i?e<o?e-i:o-i:o<e?o-t:e-t}function Vm(t,e,i,o,r,n){let s=0,a=0,l=Math.min(i-e,n-r);if(e===0&&r===0&&(s=Dm(t,o,l)),i===t.length&&n===o.length&&(a=Fm(t,o,l-s)),e+=s,r+=s,i-=a,n-=a,i-e===0&&n-r===0)return Hi;if(e===i){let S=new Le(e,[],0);for(;r<n;)S.removed.push(o[r++]);return[S]}else if(r===n)return[new Le(e,[],i-e)];let d=Rm(Am(t,e,i,o,r,n)),u=[],p,v=e,k=r;for(let S=0;S<d.length;++S)switch(d[S]){case Ue.leave:p!==void 0&&(u.push(p),p=void 0),v++,k++;break;case Ue.update:p===void 0&&(p=new Le(v,[],0)),p.addedCount++,v++,p.removed.push(o[k]),k++;break;case Ue.add:p===void 0&&(p=new Le(v,[],0)),p.addedCount++,v++;break;case Ue.delete:p===void 0&&(p=new Le(v,[],0)),p.removed.push(o[k]),k++;break}return p!==void 0&&u.push(p),u}function Om(t,e){let i=!1,o=0;for(let r=0;r<e.length;r++){let n=e[r];if(n.index+=o,i)continue;let s=Mm(t.index,t.index+t.removed.length,n.index,n.index+n.addedCount);if(s>=0){e.splice(r,1),r--,o-=n.addedCount-n.removed.length,t.addedCount+=n.addedCount-s;let a=t.removed.length+n.removed.length-s;if(!t.addedCount&&!a)i=!0;else{let l=n.removed;if(t.index<n.index){let d=t.removed.slice(0,n.index-t.index);d.push(...l),l=d}if(t.index+t.removed.length>n.index+n.addedCount){let d=t.removed.slice(n.index+n.addedCount-t.index);l.push(...d)}t.removed=l,n.index<t.index&&(t.index=n.index)}}else if(t.index<n.index){i=!0,e.splice(r,0,t),r++;let a=t.addedCount-t.removed.length;n.index+=a,o+=a}}i||e.push(t)}function Lm(t,e){let i=[],o=[];for(let r=0,n=e.length;r<n;r++)Om(e[r],o);for(let r=0,n=o.length;r<n;++r){let s=o[r];if(s.addedCount===1&&s.removed.length===1){s.removed[0]!==t[s.index]&&i.push(s);continue}i=i.concat(Vm(t,s.index,s.index+s.addedCount,s.removed,0,s.removed.length))}return i}var us=Object.freeze({support:Im.optimized,normalize(t,e,i){return t===void 0?i===void 0?Hi:Lm(e,i):ds},pop(t,e,i,o){let r=t.length>0,n=i.apply(t,o);return r&&e.addSplice(new Le(t.length,[n],0)),n},push(t,e,i,o){let r=i.apply(t,o);return e.addSplice(new Le(t.length-o.length,[],o.length).adjustTo(t)),r},reverse(t,e,i,o){let r=i.apply(t,o);t.sorted++;let n=[];for(let s=t.length-1;s>=0;s--)n.push(s);return e.addSort(new Vr(n)),r},shift(t,e,i,o){let r=t.length>0,n=i.apply(t,o);return r&&e.addSplice(new Le(0,[n],0)),n},sort(t,e,i,o){let r=new Map;for(let a=0,l=t.length;a<l;++a){let d=r.get(t[a])||[];r.set(t[a],[...d,a])}let n=i.apply(t,o);t.sorted++;let s=[];for(let a=0,l=t.length;a<l;++a){let d=r.get(t[a]);s.push(d[0]),r.set(t[a],d.splice(1))}return e.addSort(new Vr(s)),n},splice(t,e,i,o){let r=i.apply(t,o);return e.addSplice(new Le(+o[0],r,o.length>2?o.length-2:0).adjustTo(t)),r},unshift(t,e,i,o){let r=i.apply(t,o);return e.addSplice(new Le(0,[],o.length).adjustTo(t)),r}}),Z_=Object.freeze({reset:ds,setDefaultStrategy(t){us=t}});function ls(t,e,i,o=!0){Reflect.defineProperty(t,e,{value:i,enumerable:!1,writable:o})}var cs=class extends ei{get strategy(){return this._strategy}set strategy(e){this._strategy=e}get lengthObserver(){let e=this._lengthObserver;if(e===void 0){let i=this.subject;this._lengthObserver=e={length:i.length,handleChange(){this.length!==i.length&&(this.length=i.length,T.notify(e,"length"))}},this.subscribe(e)}return e}get sortObserver(){let e=this._sortObserver;if(e===void 0){let i=this.subject;this._sortObserver=e={sorted:i.sorted,handleChange(){this.sorted!==i.sorted&&(this.sorted=i.sorted,T.notify(e,"sorted"))}},this.subscribe(e)}return e}constructor(e){super(e),this.oldCollection=void 0,this.splices=void 0,this.sorts=void 0,this.needsQueue=!0,this._strategy=null,this._lengthObserver=void 0,this._sortObserver=void 0,this.call=this.flush,ls(e,"$fastController",this)}subscribe(e){this.flush(),super.subscribe(e)}addSplice(e){this.splices===void 0?this.splices=[e]:this.splices.push(e),this.enqueue()}addSort(e){this.sorts===void 0?this.sorts=[e]:this.sorts.push(e),this.enqueue()}reset(e){this.oldCollection=e,this.enqueue()}flush(){var e;let i=this.splices,o=this.sorts,r=this.oldCollection;i===void 0&&r===void 0&&o===void 0||(this.needsQueue=!0,this.splices=void 0,this.sorts=void 0,this.oldCollection=void 0,o!==void 0?this.notify(i===void 0&&r===void 0?o:ds):this.notify(((e=this._strategy)!==null&&e!==void 0?e:us).normalize(r,this.subject,i)))}enqueue(){this.needsQueue&&(this.needsQueue=!1,M.enqueue(this))}},Il=!1,Rl=Object.freeze({sorted:0,enable(){if(Il)return;Il=!0,T.setArrayObserverFactory(e=>new cs(e));let t=Array.prototype;t.$fastPatch||(ls(t,"$fastPatch",1),ls(t,"sorted",0),[t.pop,t.push,t.reverse,t.shift,t.sort,t.splice,t.unshift].forEach(e=>{t[e.name]=function(...i){var o;let r=this.$fastController;return r===void 0?e.apply(this,i):((o=r.strategy)!==null&&o!==void 0?o:us)[e.name](this,r,e,i)}}))}});var hs=ji(),ps=Object.freeze({getForInstance:hs.getForInstance,getByType:hs.getByType,define(t){return hs.register({type:t}),t}});function Dl(t,e){let i=[],o="";for(let r=0,n=t.length-1;r<n;++r){o+=t[r];let s=e[r];ps.getForInstance(s)!==void 0&&(s=s.createCSS()),s instanceof Re||s instanceof CSSStyleSheet?(o.trim()!==""&&(i.push(o),o=""),i.push(s)):o+=s}return o+=t[t.length-1],o.trim()!==""&&i.push(o),i}var b=((t,...e)=>new Re(Dl(t,e))),Or=class{constructor(e){this.value=e.length===0?"":e.length===1?e[0]:new Re(e)}createCSS(){return this.value}};ps.define(Or);b.partial=(t,...e)=>new Or(Dl(t,e));var fs=`fast-${Math.random().toString(36).substring(2,8)}`,Lr=`${fs}{`,Oo=`}${fs}`,Pm=Oo.length,Bm=0,Lo=()=>`${fs}-${++Bm}`,ni=Object.freeze({interpolation:t=>`${Lr}${t}${Oo}`,attribute:t=>`${Lo()}="${Lr}${t}${Oo}"`,comment:t=>`<!--${Lr}${t}${Oo}-->`}),Po=Object.freeze({parse(t,e){let i=t.split(Lr);if(i.length===1)return null;let o=[];for(let r=0,n=i.length;r<n;++r){let s=i[r],a=s.indexOf(Oo),l;if(a===-1)l=s;else{let d=s.substring(0,a);o.push(e[d]),l=s.substring(a+Pm)}l!==""&&o.push(l)}return o}});var ms=ji(),xe=Object.freeze({getForInstance:ms.getForInstance,getByType:ms.getByType,define(t,e){return e=e||{},e.type=t,ms.register(e),t},assignAspect(t,e){if(!e){t.aspectType=X.content;return}switch(t.sourceAspect=e,e[0]){case":":t.targetAspect=e.substring(1),t.aspectType=t.targetAspect==="classList"?X.tokenList:X.property;break;case"?":t.targetAspect=e.substring(1),t.aspectType=X.booleanAttribute;break;case"@":t.targetAspect=e.substring(1),t.aspectType=X.event;break;default:t.targetAspect=e,t.aspectType=X.attribute;break}}});var Bo=class{constructor(e){this.options=e}createHTML(e){return ni.attribute(e(this))}createBehavior(){return this}};Ae(Bo);var Nm=Symbol(),Vl=new WeakMap;function Hm(t){let e=Object.freeze(Object.assign(Object.assign({},t),{[Nm]:!0}));return Vl.set(e,e),e}function Fl(t){return t.nodeType===Node.COMMENT_NODE}function Ml(t){let e=t.getAttribute("data-fe");if(e===null)return null;let i=e.trim();if(!/^\d+$/.test(i))throw oe.error(ee.invalidHydrationAttributeMarker,{value:e});let o=parseInt(i,10);if(o<1)throw oe.error(ee.invalidHydrationAttributeMarker,{value:e});return o}var Ui=Hm({attributeMarkerName:"data-fe",contentBindingStartMarker(){return"fe:b"},contentBindingEndMarker(){return"fe:/b"},repeatStartMarker(){return"fe:r"},repeatEndMarker(){return"fe:/r"},elementBoundaryStartMarker(){return"fe:e"},elementBoundaryEndMarker(){return"fe:/e"},parseAttributeBindingCount:Ml,resolveAttributeBindings(t,e,i){let o=Ml(t);return o!==null?{factoryIndices:Array.from({length:o},(n,s)=>e+s),nextFactoryPointer:e+o,cleanup:()=>t.removeAttribute("data-fe")}:null},resolveContentBinding(t,e,i){return t==="fe:b"?{factoryIndices:[e],nextFactoryPointer:e+1}:null},isContentBindingStartMarker(t){return t==="fe:b"},isContentBindingEndMarker(t){return t==="fe:/b"},isRepeatViewStartMarker(t){return t==="fe:r"},isRepeatViewEndMarker(t){return t==="fe:/r"},isElementBoundaryStartMarker(t){return Fl(t)&&t.data==="fe:e"},isElementBoundaryEndMarker(t){return Fl(t)&&t.data==="fe:/e"}}),jm=Vl.get(Ui);function Pr(){return jm}var No=Symbol.for("fe-hydration");function vt(t){return t[No]===No}var Ol="unknown",Ll="content following `<!--fe:b-->` content binding marker",Pl="matching `<!--fe:/b-->` content binding close marker",Bl="matching `<!--fe:/e-->` element boundary close marker";function Nl(t,e){let i=e?`: ${e}`:"";return`Hydration mismatch in <${t}>${i}. Install hydrationDebugger() from "@lushly-dev/fast-element/hydration.js" and pass it as enableHydration({ debugger: hydrationDebugger() }) for an "Expected / Received" report including the SSR HTML snippet.`}function vs(t){return`no more attribute bindings (template defines ${t})`}function Hl(t){return`no more content bindings (template defines ${t})`}function jl(t,e){let i=(t??Ol).toLowerCase();return Nl(i,e)}var qm={formatBindingMismatch(t,e,i,o){return{message:jl(o,void 0)}},formatStructuralError(t,e,i){return{message:jl(e,i)}}},Wm=qm;function Br(){return Wm}function wi(t){var e;return t?(e=t.getRootNode().host)===null||e===void 0?void 0:e.nodeName:void 0}var gs,bs,bk=(gs=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(customElements),"define"))===null||gs===void 0?void 0:gs.value,yk=(bs=Object.getOwnPropertyDescriptor(Array.prototype,Symbol.iterator))===null||bs===void 0?void 0:bs.value,Km=new WeakMap;function ql(t){return Km.get(Object.getPrototypeOf(t))===!0}function Nr(t){return t.nodeType===8}function Um(t){return t.nodeType===3}function Kl(t){return Nr(t)||Um(t)?t.data.length:t.childNodes.length}var Ul=133;function ys(t,e){let i=document.createRange();return i.setStart(t,0),i.setEnd(e,Kl(e)),i}function Wl(t,e,i=t){let o=ys(t,e),r=o.startContainer===t?document.createTreeWalker(o.commonAncestorContainer,Ul):null,n=e.contains(i),s=!1;r!==null&&(r.currentNode=i);function a(l){if(r===null||!s&&l&&r.currentNode.contains(e))return null;let d=r.currentNode,u=l?r.nextSibling():r.nextNode();return s||!n||e.contains(u)?(u===e&&(n=!0),u):(r.currentNode=d,null)}return[a,()=>{if(r!==null&&!s&&(o.startContainer!==t||o.endContainer!==e||o.endOffset!==Kl(e)||r.currentNode!==t&&r.currentNode!==e&&!o.intersectsNode(r.currentNode))){let l=r.currentNode;r=document.createTreeWalker(r.root,r.whatToShow,{acceptNode:d=>o.comparePoint(d,0)===0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}),r.currentNode=l,s=!0}}]}function Gl(t,e){let i=t.parentNode;if(i===null||i!==e.parentNode||t!==e&&!(t.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)){let[s,a]=Wl(t,e);return[s,a,()=>{}]}let o=t,r=null;function n(s=!1){if(r!==null)return r[0](s);if(s&&o===e)return null;let a=o;do if(s){if(a===e)return null;a=a.nextSibling}else{let l=a;for(a=a.firstChild;a===null;){if(l===e)return null;if(a=l.nextSibling,l=l.parentNode,l===i||l===null)break}}while(a!==null&&!(Ul&1<<a.nodeType-1));return a!==null&&(o=a),a}return[n,()=>r?.[1](),()=>{r??(r=Wl(t,e,o))}]}var Ho=class extends Error{constructor(e,i,o,r,n){super(e),this.factories=i,this.node=o,this.expected=r,this.received=n}},Yl=Element.prototype.removeAttribute,Xl=Element.prototype.getAttribute,Gm=Element.prototype.hasAttribute;function Jl(t,e,i){let o=t;for(;o!==null;){let r=Object.getOwnPropertyDescriptor(o,e);if(r!==void 0)return r.value===i;o=Object.getPrototypeOf(o)}return!1}function Ql(t,e){return e?Gm.call(t,"is")||!Jl(t,"removeAttribute",Yl):t.localName.includes("-")||t.hasAttribute("is")||"attributeChangedCallback"in t||t.removeAttribute!==Yl}function Gi(t,e,i){let o=Br().formatStructuralError(t,wi(t),i);throw new Ho(o.message,e,t,o.expected,o.received)}function Zl(t,e,i){var o;let[r,n,s]=Gl(t,e),a={},l={},d=Pr(),u=d===Ui;d!==Ui&&s();let p=Qm(i),v=p,k=t;for(;k!==null;){switch(k.nodeType){case Node.ELEMENT_NODE:{let S=k,R=u&&S.localName.includes("-"),F=R&&ql(S);if((R?!Jl(S,"getAttribute",Xl):S.getAttribute!==Xl)&&s(),u){let $=Ui.parseAttributeBindingCount(S);if($!==null){$>4294967295&&Ui.resolveAttributeBindings(S,v,p);for(let D=0;D<$;D++){let O=i[v++];O||Gi(k,i,vs(i.length)),jo(O,k,a)}Ql(S,F)&&s(),S.removeAttribute("data-fe"),n()}break}let _=d.resolveAttributeBindings(S,v,p);if(_!==null){v=_.nextFactoryPointer;for(let $ of _.factoryIndices){let D=i[$];D||Gi(k,i,vs(i.length)),jo(D,k,a)}Ql(S,!1)&&s(),(o=_.cleanup)===null||o===void 0||o.call(_),n()}break}case 8:{let S=k.data;if(u?S==="fe:e":d.isElementBoundaryStartMarker(k))k.data="",Xm(r,i,k,d,u);else{let R;if(u){if(S!=="fe:b")break;R=v++}else{let _=d.resolveContentBinding(S,v,p);if(_===null)break;v=_.nextFactoryPointer,R=_.factoryIndices[0]}let F=i[R];F||Gi(k,i,Hl(i.length)),Ym(k,r,F,i,a,l,d,u)}break}}k=r()}return{targets:a,boundaries:l}}function Ym(t,e,i,o,r,n,s,a){let l=e(!0);t.data="",l===null&&Gi(t,o,Ll);let d=l,u=0;for(;l!==null;){if(Nr(l)){if(a?l.data==="fe:b":s.isContentBindingStartMarker(l.data))u++;else if(a?l.data==="fe:/b":s.isContentBindingEndMarker(l.data)){if(u===0)break;u--}}l=e(!0)}l===null&&Gi(t,o,Pl),l.data="",l!==d&&l.previousSibling!==null&&(n[i.targetNodeId]={first:d,last:l.previousSibling}),jo(i,l,r)}function Xm(t,e,i,o,r){let n=0,s=t(!0);for(;s!==null;){if(Nr(s)){if(r?s.data==="fe:e":o.isElementBoundaryStartMarker(s))s.data="",n++;else if((r?s.data==="fe:/e":o.isElementBoundaryEndMarker(s))&&(s.data="",n--===0))return}s=t(!0)}Gi(i,e,Bl)}function Qm(t){let e=0;for(;e<t.length&&t[e].targetNodeId==="h";)e++;return e}function jo(t,e,i){let o=t.targetNodeId;if(o===void 0)throw new Error("Factory could not be target to the node");i[o]=e}function ot(t,e){let i=e._scope;return i===void 0?t.create():t.create(void 0,i)}function Xi(t,e,i,o){let r=o._scope;return r===void 0?t.hydrate(e,i):t.hydrate(e,i,void 0,r)}function Yi(t,e){let i=t.parentNode,o=t,r;for(;o!==e;){if(r=o.nextSibling,!r)throw new Error(`Unmatched first/last child inside "${e.getRootNode().host.nodeName}".`);i.removeChild(o),o=r}i.removeChild(e)}var qo=class{constructor(){this.index=0,this.length=0}get event(){return Lt.getEvent()}get isEven(){return this.index%2===0}get isOdd(){return this.index%2!==0}get isFirst(){return this.index===0}get isInMiddle(){return!this.isFirst&&!this.isLast}get isLast(){return this.index===this.length-1}eventDetail(){return this.event.detail}eventTarget(){return this.event.target}},Nt=class extends qo{constructor(e,i,o,r){super(),this.fragment=e,this.factories=i,this.targets=o,this._scope=r,this.behaviors=null,this.unbindables=[],this.source=null,this.isBound=!1,this.sourceLifetime=Ot.unknown,this._skipAttrUpdates=!1,this.isPrerendered=Promise.resolve(!1),this.isHydrated=Promise.resolve(!1),this.context=this,this.firstChild=e.firstChild,this.lastChild=e.lastChild}appendTo(e){e.appendChild(this.fragment)}insertBefore(e){if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let i=this.lastChild;if(e.previousSibling===i)return;let o=e.parentNode,r=this.firstChild,n;for(;r!==i;)n=r.nextSibling,o.insertBefore(r,e),r=n;o.insertBefore(i,e)}}remove(){let e=this.fragment,i=this.lastChild,o=this.firstChild,r;for(;o!==i;)r=o.nextSibling,e.appendChild(o),o=r;e.appendChild(i)}dispose(){Yi(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}bind(e,i=this){if(this.source===e&&this.context===i)return;let o=this.behaviors;if(o===null){this.source=e,this.context=i,this.behaviors=o=new Array(this.factories.length);let r=this.factories;for(let n=0,s=r.length;n<s;++n){let a=r[n].createBehavior();a.bind(this),o[n]=a}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=i;for(let r=0,n=o.length;r<n;++r)o[r].bind(this)}this.isBound=!0}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}evaluateUnbindables(){let e=this.unbindables;for(let i=0,o=e.length;i<o;++i)e[i].unbind(this);e.length=0}static disposeContiguousBatch(e){if(e.length!==0){Yi(e[0].firstChild,e[e.length-1].lastChild);for(let i=0,o=e.length;i<o;++i)e[i].unbind()}}};Ae(Nt);T.defineProperty(Nt.prototype,"index");T.defineProperty(Nt.prototype,"length");var ec,rt={unhydrated:"unhydrated",hydrating:"hydrating",hydrated:"hydrated"},xs=class extends Error{constructor(e,i,o,r,n,s){super(e),this.factory=i,this.fragment=o,this.templateString=r,this.expected=n,this.received=s}},ws=class extends qo{get hydrationStage(){return this._hydrationStage}get targets(){return this._targets}get bindingViewBoundaries(){return this._bindingViewBoundaries}constructor(e,i,o,r,n){super(),this.firstChild=e,this.lastChild=i,this.sourceTemplate=o,this.hostBindingTarget=r,this._scope=n,this[ec]=No,this.context=this,this.source=null,this.isBound=!1,this.sourceLifetime=Ot.unknown,this.unbindables=[],this.fragment=null,this.behaviors=null,this._hydrationStage=rt.unhydrated,this._bindingViewBoundaries={},this._targets={},this.factories=o.compile().factories}insertBefore(e){if(this.fragment!==null)if(this.fragment.hasChildNodes())e.parentNode.insertBefore(this.fragment,e);else{let i=this.lastChild;if(e.previousSibling===i)return;let o=e.parentNode,r=this.firstChild,n;for(;r!==i;)n=r.nextSibling,o.insertBefore(r,e),r=n;o.insertBefore(i,e)}}appendTo(e){this.fragment!==null&&e.appendChild(this.fragment)}remove(){let e=this.fragment||(this.fragment=document.createDocumentFragment()),i=this.lastChild,o=this.firstChild,r;for(;o!==i;){if(r=o.nextSibling,!r)throw new Error(`Unmatched first/last child inside "${i.getRootNode().host.nodeName}".`);e.appendChild(o),o=r}e.appendChild(i)}bind(e,i=this){if(this.source===e&&this.context===i)return;this.hydrationStage!==rt.hydrated&&(this._hydrationStage=rt.hydrating);let o=this.behaviors;if(o===null){this.source=e,this.context=i;try{let{targets:n,boundaries:s}=Zl(this.firstChild,this.lastChild,this.factories);this._targets=n,this._bindingViewBoundaries=s}catch(n){if(n instanceof Ho){let s=this.sourceTemplate.html;typeof s!="string"&&(s=s.innerHTML),n.templateString=s}throw n}this.behaviors=o=new Array(this.factories.length);let r=this.factories;for(let n=0,s=r.length;n<s;++n){let a=r[n];if(a.targetNodeId==="h"&&this.hostBindingTarget&&jo(a,this.hostBindingTarget,this._targets),a.targetNodeId in this.targets){let l=a.createBehavior();l.bind(this),o[n]=l}else{let l=this.sourceTemplate.html;typeof l!="string"&&(l=l.innerHTML);let d=ys(this.firstChild,this.lastChild).cloneContents(),u=Br().formatBindingMismatch(a,this.firstChild,this.lastChild,wi(this.firstChild));throw new xs(u.message,a,d,l,u.expected,u.received)}}}else{this.source!==null&&this.evaluateUnbindables(),this.isBound=!1,this.source=e,this.context=i;for(let r=0,n=o.length;r<n;++r)o[r].bind(this)}this.isBound=!0,this._hydrationStage=rt.hydrated}unbind(){!this.isBound||this.source===null||(this.evaluateUnbindables(),this.source=null,this.context=this,this.isBound=!1)}dispose(){Yi(this.firstChild,this.lastChild),this.unbind()}onUnbind(e){this.unbindables.push(e)}evaluateUnbindables(){let e=this.unbindables;for(let i=0,o=e.length;i<o;++i)e[i].unbind(this);e.length=0}};ec=No;Ae(ws);function Jm(t){return t.create!==void 0}function tc(t,e){if(t.nodeType!==8){t.textContent=e;return}let i=t.$fastText;i!==void 0&&(i.textContent=e),e===""?i?.remove():(i===void 0&&(t.$fastText=i=document.createTextNode(e)),i.parentNode!==t.parentNode&&t.parentNode.insertBefore(i,t))}function Zm(t,e,i,o){if(i==null&&(i=""),Jm(i)){tc(t,"");let r=t.$fastView;if(r===void 0)if(vt(o)&&vt(i)&&o.bindingViewBoundaries[this.targetNodeId]!==void 0&&o.hydrationStage!==rt.hydrated){let n=o.bindingViewBoundaries[this.targetNodeId];r=Xi(i,n.first,n.last,o)}else r=ot(i,o);else t.$fastTemplate!==i&&(r.isComposed&&(r.remove(),r.unbind()),r=ot(i,o));r.isComposed?r.needsBindOnly&&(r.needsBindOnly=!1,r.bind(o.source,o.context)):(r.isComposed=!0,r.bind(o.source,o.context),r.insertBefore(t),t.$fastView=r,t.$fastTemplate=i)}else{let r=t.$fastView;if(r!==void 0&&r.isComposed&&(r.isComposed=!1,r.remove(),r.needsBindOnly?r.needsBindOnly=!1:r.unbind()),r===void 0&&vt(o)&&o.hydrationStage!==rt.hydrated){let n=o.bindingViewBoundaries[this.targetNodeId];n!==void 0&&(t.nodeType===8&&n.first===n.last&&n.first.nodeType===3?t.$fastText=n.first:Yi(n.first,n.last),delete o.bindingViewBoundaries[this.targetNodeId])}tc(t,i)}}function ev(t,e,i){var o;let r=`${this.id}-t`,n=(o=t[r])!==null&&o!==void 0?o:t[r]={v:0,cv:Object.create(null)},s=n.cv,a=n.v,l=t[e];if(i!=null&&i.length){let d=i.split(/\s+/);for(let u=0,p=d.length;u<p;++u){let v=d[u];v!==""&&(s[v]=a,l.add(v))}}if(n.v=a+1,a!==0){a-=1;for(let d in s)s[d]===a&&l.remove(d)}}var tv={[X.attribute]:Bt.setAttribute,[X.booleanAttribute]:Bt.setBooleanAttribute,[X.property]:(t,e,i)=>t[e]=i,[X.content]:Zm,[X.tokenList]:ev,[X.event]:()=>{}},nt=class{constructor(e){this.updateTarget=null,this.aspectType=X.content,this.dataBinding=e}createHTML(e){return ni.interpolation(e(this))}createBehavior(){var e;if(this.updateTarget===null){let i=tv[this.aspectType],o=(e=this.dataBinding.policy)!==null&&e!==void 0?e:this.policy;if(!i)throw oe.error(ee.unsupportedBindingBehavior);this.data=`${this.id}-d`,this.updateTarget=o.protect(this.targetTagName,this.aspectType,this.targetAspect,i)}return this}bind(e){var i;let o=e.targets[this.targetNodeId];switch(this.aspectType){case X.event:o[this.data]=e,o.addEventListener(this.targetAspect,this,this.dataBinding.options);break;case X.content:e.onUnbind(this);default:{let r=(i=o[this.data])!==null&&i!==void 0?i:o[this.data]=this.dataBinding.createObserver(this,this);r.target=o,r.controller=e;let n=r.bind(e);if(e._skipAttrUpdates&&(this.aspectType===X.attribute||this.aspectType===X.booleanAttribute))break;this.updateTarget(o,this.targetAspect,n,e);break}}}unbind(e){let o=e.targets[this.targetNodeId].$fastView;o!==void 0&&o.isComposed&&(o.unbind(),o.needsBindOnly=!0)}handleEvent(e){let i=e.currentTarget[this.data];if(i.isBound){Lt.setEvent(e);let o=this.dataBinding.evaluate(i.source,i.context);Lt.setEvent(null),o!==!0&&e.preventDefault()}}handleChange(e,i){let o=i.controller;if(!o.isBound)return;let r=i.target;this.updateTarget(r,this.targetAspect,i.bind(o),o)}};xe.define(nt,{aspected:!0});var sc=(t,e)=>`${t}.${e}`,ic={},gt={index:0,node:null};function oc(t){t.startsWith("fast-")||oe.warn(ee.hostBindingWithoutHost,{name:t})}var iv=new Proxy(document.createElement("div"),{get(t,e){oc(e);let i=Reflect.get(t,e);return ie(i)?i.bind(t):i},set(t,e,i){return oc(e),Reflect.set(t,e,i)}}),_s=class{constructor(e,i,o){this.fragment=e,this.directives=i,this.policy=o,this.proto=null,this.nodeIds=new Set,this.descriptors={},this.factories=[]}addFactory(e,i,o,r,n){var s,a;this.nodeIds.has(o)||(this.nodeIds.add(o),this.addTargetDescriptor(i,o,r)),e.id=(s=e.id)!==null&&s!==void 0?s:Lo(),e.targetNodeId=o,e.targetTagName=n,e.policy=(a=e.policy)!==null&&a!==void 0?a:this.policy,this.factories.push(e)}freeze(){return this.proto=Object.create(null,this.descriptors),this}addTargetDescriptor(e,i,o){let r=this.descriptors;if(i==="r"||i==="h"||r[i])return;if(!r[e]){let s=e.lastIndexOf("."),a=e.substring(0,s),l=parseInt(e.substring(s+1),10);this.addTargetDescriptor(a,e,l)}let n=ic[i];if(!n){let s=`_${i}`;ic[i]=n={get(){var a;return(a=this[s])!==null&&a!==void 0?a:this[s]=this[e].childNodes[o]}}}r[i]=n}createView(e,i){let o=i===void 0?this.fragment.cloneNode(!0):rv(this.fragment,i),r=Object.create(this.proto);r.r=o,r.h=e??iv;for(let n of this.nodeIds)Reflect.get(r,n);return new Nt(o,this.factories,r,i)}},Wo,rc=new WeakMap;function ov(t){let e=rc.get(t);return e===void 0&&(Wo??(Wo=document.implementation.createHTMLDocument("")),e=t.cloneNode(!0),Wo.adoptNode(e),rc.set(t,e)),e}function rv(t,e){var i;let o=e,r=(i=o.customElementRegistry)!==null&&i!==void 0?i:o.registry;if(r){if(r!==globalThis.customElements&&typeof r.initialize=="function")return document.importNode(ov(t),{selfOnly:!1,customElementRegistry:r});if(typeof o.importNode=="function")return o.importNode(t,!0)}return t.cloneNode(!0)}function ac(t,e,i,o,r,n=!1){let s=i.attributes,a=t.directives;for(let l=0,d=s.length;l<d;++l){let u=s[l],p=u.value,v=Po.parse(p,a),k=null;v===null?n&&(k=new nt(it(()=>p,t.policy)),xe.assignAspect(k,u.name)):k=Hr.aggregate(v,t.policy),k!==null&&(i.removeAttributeNode(u),l--,d--,t.addFactory(k,e,o,r,i.tagName))}}function nv(t,e,i,o,r){let n=Po.parse(e.textContent,t.directives);if(n===null)return gt.node=e.nextSibling,gt.index=r+1,gt;let s,a=s=e;for(let l=0,d=n.length;l<d;++l){let u=n[l];if(l!==0&&(r++,o=sc(i,r),s=a.parentNode.insertBefore(document.createTextNode(""),a.nextSibling)),be(u))s.textContent=u;else{if(xe.assignAspect(u),u instanceof nt){let p=document.createComment("");s.parentNode.replaceChild(p,s),s=p}else s.textContent=" ";t.addFactory(u,i,o,r,null)}a=s}return gt.index=r+1,gt.node=a.nextSibling,gt}function lc(t,e,i){let o=0,r=e.firstChild;for(;r;){let n=sv(t,i,r,o);r=n.node,o=n.index}}function sv(t,e,i,o){let r=sc(e,o);switch(i.nodeType){case 1:ac(t,e,i,r,o),lc(t,i,r);break;case 3:return nv(t,i,e,r,o);case 8:{let n=Po.parse(i.data,t.directives);n!==null&&t.addFactory(Hr.aggregate(n),e,r,o,null);break}}return gt.index=o+1,gt.node=i.nextSibling,gt}function av(t,e){if(!t||t.nodeType!==8&&t.nodeType!==3)return!1;let i=Po.parse(t.data,e);return i!==null&&(t.nodeType===8||!be(i[0]))}var nc="TEMPLATE",Hr={compile(t,e,i=Bt.policy){let o;if(be(t)){o=document.createElement(nc),o.innerHTML=i.createHTML(t);let s=o.content.firstElementChild;s!==null&&s.tagName===nc&&(o=s)}else o=t;!o.content.firstChild&&!o.content.lastChild&&o.content.appendChild(document.createComment(""));let r=document.adoptNode(o.content),n=new _s(r,e,i);return ac(n,"",o,"h",0,!0),(av(r.firstChild,e)||r.childNodes.length===1&&Object.keys(e).length>0)&&r.insertBefore(document.createComment(""),r.firstChild),lc(n,r,"r"),gt.node=null,n.freeze()},setDefaultStrategy(t){this.compile=t},aggregate(t,e=Bt.policy){if(t.length===1)return t[0];let i,o=!1,r,n=t.length,s=t.map(d=>be(d)?()=>d:(i=d.sourceAspect||i,o=o||d.dataBinding.isVolatile,r=r||d.dataBinding.policy,d.dataBinding.evaluate)),a=(d,u)=>{let p="";for(let v=0;v<n;++v)p+=s[v](d,u);return p},l=new nt(oi(a,r??e,o));return xe.assignAspect(l,i),l}};var Ko=class extends Bo{bind(e){e.source[this.options]=e.targets[this.targetNodeId]}};xe.define(Ko);var jr=t=>new Ko(t);var lv=/([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/,cv=Object.create(null),si=class{constructor(e,i=cv){this.html=e,this.factories=i}createHTML(e){let i=this.factories;for(let o in i)e(i[o]);return this.html}};si.empty=new si("");xe.define(si);function dv(t,e,i,o=xe.getForInstance(t)){if(o.aspected){let r=lv.exec(e);r!==null&&xe.assignAspect(t,r[2])}return t.createHTML(i)}var _i=class t{constructor(e,i={},o){this.policy=o,this.result=null,this.html=e,this.factories=i}compile(){return this.result===null&&(this.result=Hr.compile(this.html,this.factories,this.policy)),this.result}inline(){return new si(be(this.html)?this.html:this.html.innerHTML,this.factories)}withPolicy(e){if(this.result)throw oe.error(ee.cannotSetTemplatePolicyAfterCompilation);if(this.policy)throw oe.error(ee.onlySetTemplatePolicyOnce);return this.policy=e,this}render(e,i,o,r){let n=this.create(o,r);return n.bind(e),n.appendTo(i),n}create(e,i){return this.compile().createView(e,i)}static create(e,i,o){let r="",n=Object.create(null),s=a=>{var l;let d=(l=a.id)!==null&&l!==void 0?l:a.id=Lo();return n[d]=a,d};for(let a=0,l=e.length-1;a<l;++a){let d=e[a],u=i[a],p;if(r+=d,ie(u))u=new nt(oi(u));else if(u instanceof Ke)u=new nt(u);else if(!(p=xe.getForInstance(u))){let v=u;u=new nt(it(()=>v))}r+=dv(u,d,s,p)}return new t(r+e[e.length-1],n,o)}};Ae(_i);var h=((t,...e)=>{if(Array.isArray(t)&&Array.isArray(t.raw))return _i.create(t,e);throw oe.error(ee.directCallToHTMLTagNotAllowed)});h.partial=t=>new si(t);var Wr=class{constructor(e){this.directive=e,this.location=null,this.controller=null,this.view=null,this.data=null,this.dataBindingObserver=e.dataBinding.createObserver(this,e),this.templateBindingObserver=e.templateBinding.createObserver(this,e)}bind(e){if(this.location=e.targets[this.directive.targetNodeId],this.controller=e,this.data=this.dataBindingObserver.bind(e),this.template=this.templateBindingObserver.bind(e),e.onUnbind(this),vt(this.template)&&vt(e)&&e.hydrationStage!==rt.hydrated&&!this.view){let i=e.bindingViewBoundaries[this.directive.targetNodeId];if(i){this.view=Xi(this.template,i.first,i.last,e),this.bindView(this.view);return}}this.refreshView()}unbind(e){let i=this.view;i!==null&&i.isComposed&&(i.unbind(),i.needsBindOnly=!0)}handleChange(e,i){this.controller.isBound&&(i===this.dataBindingObserver&&(this.data=this.dataBindingObserver.bind(this.controller)),(this.directive.templateBindingDependsOnData||i===this.templateBindingObserver)&&(this.template=this.templateBindingObserver.bind(this.controller)),this.refreshView())}bindView(e){e.isComposed?e.needsBindOnly&&(e.needsBindOnly=!1,e.bind(this.data)):(e.isComposed=!0,e.bind(this.data),e.insertBefore(this.location),e.$fastTemplate=this.template)}refreshView(){let e=this.view,i=this.template;e===null?(this.view=e=ot(i,this.controller),this.view.context.parent=this.controller.source,this.view.context.parentContext=this.controller.context):e.$fastTemplate!==i&&(e.isComposed&&(e.remove(),e.unbind()),this.view=e=ot(i,this.controller),this.view.context.parent=this.controller.source,this.view.context.parentContext=this.controller.context),this.bindView(e)}},Go=class{constructor(e,i,o){this.dataBinding=e,this.templateBinding=i,this.templateBindingDependsOnData=o}createHTML(e){return ni.comment(e(this))}createBehavior(){return new Wr(this)}};xe.define(Go);function uv(t){return!!t.element||!!t.tagName}var ks=new Map,hv={":model":t=>t},cc=Symbol("RenderInstruction"),dc="default-view",pv=h`
    &nbsp;
`;function qr(t){return t===void 0?pv:t.template}function fv(t,e,i,o){var r;return be(t)?qr(Uo(e.evaluate(i,o),t)):t instanceof Node?(r=t.$fastTemplate)!==null&&r!==void 0?r:new Qi(t):t}function mv(t,e){let i=t.evaluate,o=Object.create(Object.getPrototypeOf(t));for(let r of Object.getOwnPropertyNames(t))r!=="evaluate"&&Object.defineProperty(o,r,Object.getOwnPropertyDescriptor(t,r));return Object.defineProperty(o,"evaluate",{configurable:!0,enumerable:!0,value:(r,n)=>fv(i(r,n),e,r,n),writable:!0}),o}function uc(t,e){let i=[],o=[],{attributes:r,directives:n,content:s,policy:a}=e??{};if(i.push(`<${t}`),r){let l=Object.getOwnPropertyNames(r);for(let d=0,u=l.length;d<u;++d){let p=l[d];d===0?i[0]=`${i[0]} ${p}="`:i.push(`" ${p}="`),o.push(r[p])}i.push('"')}if(n){i[i.length-1]+=" ";for(let l=0,d=n.length;l<d;++l){let u=n[l];i.push(l>0?"":" "),o.push(u)}}if(i[i.length-1]+=">",s&&ie(s.create))o.push(s),i.push(`</${t}>`);else{let l=i.length-1;i[l]=`${i[l]}${s??""}</${t}>`}return _i.create(i,o,a)}function hc(t){var e;let i=(e=t.name)!==null&&e!==void 0?e:dc,o;if(uv(t)){let r=t.tagName;if(!r){let n=ye.getByType(t.element);if(n)r=n.name;else throw new Error("Invalid element for model rendering.")}t.attributes||(t.attributes=hv),o=uc(r,t)}else o=t.template;return{brand:cc,type:t.type,name:i,template:o}}function pc(t){return t&&t.brand===cc}function vv(t){let e=ks.get(t.type);e===void 0&&ks.set(t.type,e=Object.create(null));let i=pc(t)?t:hc(t);if(e[i.name]!==void 0){let o=i.type.name||"(anonymous)";oe.warn(ee.duplicateRenderInstruction,{type:o,name:i.name})}return e[i.name]=i}function fc(t,e){let i=ks.get(t);if(i!==void 0)return i[e??dc]}function Uo(t,e){if(t)return fc(t.constructor,e)}var IC=Object.freeze({instanceOf:pc,create:hc,createElementTemplate:uc,register:vv,getByType:fc,getForInstance:Uo});var Qi=class{constructor(e){this.node=e,e.$fastTemplate=this}get context(){return this}bind(e){}unbind(){}insertBefore(e){e.parentNode.insertBefore(this.node,e)}remove(){this.node.parentNode.removeChild(this.node)}create(){return this}hydrate(e,i){return this}};function ki(t,e){let i;t===void 0?i=it(n=>n):i=Vo(t);let o,r=!1;return e===void 0?(r=!0,o=it((n,s)=>{var a;let l=i.evaluate(n,s);return l instanceof Node?(a=l.$fastTemplate)!==null&&a!==void 0?a:new Qi(l):qr(Uo(l))})):ie(e)?o=oi((n,s)=>{var a;let l=e(n,s);return be(l)?l=qr(Uo(i.evaluate(n,s),l)):l instanceof Node&&(l=(a=l.$fastTemplate)!==null&&a!==void 0?a:new Qi(l)),l},void 0,!0):be(e)?(r=!0,o=it((n,s)=>{var a;let l=i.evaluate(n,s);return l instanceof Node?(a=l.$fastTemplate)!==null&&a!==void 0?a:new Qi(l):qr(Uo(l,e))})):e instanceof Ke?o=mv(e,i):o=it((n,s)=>e),new Go(i,o,r)}function gv(t){return t.nodeType===Node.COMMENT_NODE}function mc(t,e,i){let o=[],r=[],n=t;for(;n!==null&&n!==e;){if(gv(n)){let s=n.data;if(i.isRepeatViewStartMarker(s))r.push(n);else if(i.isRepeatViewEndMarker(s)){let a=r.pop();if(a===void 0){let l=n.previousSibling===null?"end should never be null.":"repeat start marker not found.";throw new Error(`Error when hydrating inside "${wi(e)}": ${l}`)}if(r.length===0){let l=a.nextSibling,d=n.previousSibling;o.push({start:l,end:d===a?l:d,startMarker:a,endMarker:n})}}}n=n.nextSibling}if(r.length!==0)throw new Error(`Error when hydrating inside "${wi(e)}": repeat end marker not found.`);return o}var vc=Object.freeze({positioning:!1,recycle:!0});function bv(t,e,i,o){t.context.parent=o.source,t.context.parentContext=o.context,t.bind(e[i])}function yv(t,e,i,o){t.context.parent=o.source,t.context.parentContext=o.context,t.context.length=e.length,t.context.index=i,t.bind(e[i])}function xv(t,e){let i=t.parentNode;if(i===null)return;let o=t;for(;o!==null;){let r=o.nextSibling;if(i.removeChild(o),o===e)break;o=r}}var Kr=class extends Error{constructor(e,i){super(e),this.propertyBag=i}},Ur=class{constructor(e){this.directive=e,this.isBound=!1,this.items=null,this.itemsObserver=null,this.bindView=bv,this.views=[],this.itemsBindingObserver=e.dataBinding.createObserver(this,e),this.templateBindingObserver=e.templateBinding.createObserver(this,e),e.options.positioning&&(this.bindView=yv)}bind(e){this.location=e.targets[this.directive.targetNodeId],this.controller=e,this.isBound=!0,this.items=this.itemsBindingObserver.bind(e),this.template=this.templateBindingObserver.bind(e),this.observeItems(!0),vt(this.template)&&vt(e)&&e.hydrationStage!==rt.hydrated?this.hydrateViews(this.template):this.refreshAllViews(),e.onUnbind(this)}unbind(){this.isBound=!1,this.itemsObserver!==null&&this.itemsObserver.unsubscribe(this),this.unbindAllViews()}handleChange(e,i){if(this.isBound)if(i===this.itemsBindingObserver)this.items=this.itemsBindingObserver.bind(this.controller),this.observeItems(),this.refreshAllViews();else if(i===this.templateBindingObserver)this.template=this.templateBindingObserver.bind(this.controller),this.refreshAllViews(!0);else if(i[0])i[0].reset?this.refreshAllViews():i[0].sorted?this.updateSortedViews(i):this.updateSplicedViews(i);else return}observeItems(e=!1){if(!this.items){this.items=Hi;return}let i=this.itemsObserver,o=this.itemsObserver=T.getNotifier(this.items),r=i!==o;r&&i!==null&&i.unsubscribe(this),(r||e)&&o.subscribe(this)}updateSortedViews(e){let i=this.views;for(let o=0,r=e.length;o<r;++o){let n=e[o].sorted.slice(),s=n.slice().sort((a,l)=>a-l);for(let a=0,l=n.length;a<l;++a){let d=n.find(u=>n[a]===s[u]);if(d!==a){let u=s.splice(d,1);s.splice(a,0,...u);let p=i[a],v=p?p.firstChild:this.location;i[d].remove(),i[d].insertBefore(v);let k=i.splice(d,1);i.splice(a,0,...k)}}}}updateSplicedViews(e){let i=this.views,o=this.bindView,r=this.items,n=this.template,s=this.controller,a=this.directive.options.recycle,l=[],d=0,u=0;for(let p=0,v=e.length;p<v;++p){let k=e[p],S=k.removed,R=0,F=k.index,_=F+k.addedCount,$=i.splice(k.index,S.length),D=u=l.length+$.length;for(;F<_;++F){let O=i[F],L=O?O.firstChild:this.location,P;a&&u>0?(R<=D&&$.length>0?(P=$[R],R++):(P=l[d],d++),u--):P=ot(n,s),i.splice(F,0,P),o(P,r,F,s),P.insertBefore(L)}$[R]&&l.push(...$.slice(R))}for(let p=d,v=l.length;p<v;++p)l[p].dispose();if(this.directive.options.positioning)for(let p=0,v=i.length;p<v;++p){let k=i[p].context;k.length=v,k.index=p}}refreshAllViews(e=!1){let i=this.items,o=this.template,r=this.location,n=this.bindView,s=this.controller,a=i.length,l=this.views,d=l.length;if((a===0||e||!this.directive.options.recycle)&&(Nt.disposeContiguousBatch(l),d=0),d===0){this.views=l=new Array(a);for(let u=0;u<a;++u){let p=ot(o,s);n(p,i,u,s),l[u]=p,p.insertBefore(r)}}else{let u=0;for(;u<a;++u)if(u<d){let v=l[u];if(!v){let k=new XMLSerializer;throw new Kr(`View is null or undefined inside "${this.location.getRootNode().host.nodeName}".`,{index:u,hydrationStage:this.controller.hydrationStage,itemsLength:a,viewsState:l.map(S=>S?"hydrated":"empty"),viewTemplateString:k.serializeToString(o.create().fragment),rootNodeContent:k.serializeToString(this.location.getRootNode())})}n(v,i,u,s)}else{let v=ot(o,s);n(v,i,u,s),l.push(v),v.insertBefore(r)}let p=l.splice(u,d-u);for(u=0,a=p.length;u<a;++u)p[u].dispose()}}unbindAllViews(){let e=this.views;for(let i=0,o=e.length;i<o;++i){let r=e[i];if(!r){let n=new XMLSerializer;throw new Kr(`View is null or undefined inside "${this.location.getRootNode().host.nodeName}".`,{index:i,hydrationStage:this.controller.hydrationStage,viewsState:e.map(s=>s?"hydrated":"empty"),rootNodeContent:n.serializeToString(this.location.getRootNode())})}r.unbind()}}hydrateViews(e){var i;if(!this.items)return;let o=this.items,r=o.length,n=this.views=new Array(r),s=Pr(),a=this.controller.bindingViewBoundaries[this.directive.targetNodeId],l=mc((i=a?.first)!==null&&i!==void 0?i:this.location,this.location,s);for(let{startMarker:u,endMarker:p}of l)u.data="",p.data="";let d=Math.min(l.length,r);for(let u=0;u<d;u++){let{start:p,end:v}=l[u],k=Xi(e,p,v,this.controller);n[u]=k,this.bindView(k,o,u,this.controller)}for(let u=d;u<r;u++){let p=ot(e,this.controller);n[u]=p,this.bindView(p,o,u,this.controller),p.insertBefore(this.location)}for(let u=r,p=l.length;u<p;u++){let{startMarker:v,endMarker:k}=l[u];xv(v,k)}}},Yo=class{createHTML(e){return ni.comment(e(this))}constructor(e,i,o){this.dataBinding=e,this.templateBinding=i,this.options=o,Rl.enable()}createBehavior(){return new Ur(this)}};xe.define(Yo);function N(t,e,i=vc){let o=Vo(t),r=Vo(e);return new Yo(o,r,Object.assign(Object.assign({},vc),i))}var wv=()=>null;function gc(t){return t===void 0?wv:ie(t)?t:()=>t}function g(t,e,i){if(!ie(e)&&!ie(i)){let s=e??null,a=i??null;if(!ie(t)){let l=t?s:a;return()=>l}return(l,d)=>t(l,d)?s:a}let o=ie(t)?t:()=>t,r=gc(e),n=gc(i);return(s,a)=>o(s,a)?r(s,a):n(s,a)}var De=b`
:host{
color:var(--violet-color-text-primary,#181b1a);
font-family:var(--violet-font-family,var(--violet-font-family-body));

--_action-primary-background:var(--violet-color-action-primary-background,#181b1a);
--_action-primary-text:var(--violet-color-action-primary-text,#f4f0ea);
--_action-primary-hover:var(--violet-color-action-primary-hover,#2f383e);
--_action-primary-pressed:var(--violet-color-action-primary-pressed,#262e33);
--_action-secondary-background:var(--violet-color-action-secondary-background,rgba(24,27,26,0.07));
--_action-secondary-text:var(--violet-color-action-secondary-text,#181b1a);
--_action-secondary-border:var(--violet-color-action-secondary-border,transparent);
--_action-secondary-hover:var(--violet-color-action-secondary-hover,rgba(24,27,26,0.11));
--_action-secondary-pressed:var(--violet-color-action-secondary-pressed,rgba(24,27,26,0.15));
--_action-danger-background:var(--violet-color-action-danger-background,#c42a1a);
--_action-danger-text:var(--violet-color-action-danger-text,#ffffff);
--_action-danger-hover:var(--violet-color-action-danger-hover,#ad2416);
--_action-danger-pressed:var(--violet-color-action-danger-pressed,#96200f);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-control:var(--violet-shadow-control,0 0 0 1px rgba(24,27,26,0.05),0 1px 2px rgba(24,27,26,0.10));
--_layer-base:var(--violet-z-index-base,0);
--_layer-raised:var(--violet-z-index-raised,1);
--_layer-sticky:var(--violet-z-index-sticky,10);
--_layer-overlay:var(--violet-z-index-overlay,100);
--_layer-popover:var(--violet-z-index-popover,200);
--_layer-modal:var(--violet-z-index-modal,300);
--_layer-toast:var(--violet-z-index-toast,400);
--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_space-inline-md:var(--violet-space-inline-group,8px);
--_type-body-size:var(--violet-type-body-size,14px);
--_type-body-line:var(--violet-type-body-line,20px);
--_target-size-compact:var(--violet-size-target-compact,24px);
--_target-size-natural:var(--violet-size-target-natural,32px);
--_target-size-comfortable:var(--violet-size-target-comfortable,44px);
--_auto-target-size:var(--_target-size-natural);
--_target-size:var(--violet-target-size,var(--_auto-target-size));
--_control-type-size:var(--violet-control-type-size,var(--_type-body-size));

--_control-body-size:var(--violet-control-body-size,var(--_control-type-size));
--_duration-fast:var(--violet-duration-fast,120ms);
--_duration-base:var(--violet-duration-base,180ms);
--_easing-standard:var(--violet-easing-standard,cubic-bezier(0.2,0,0,1));
}

@media (any-pointer:coarse){
:host{
--_auto-target-size:var(--_target-size-comfortable);
}
}
@media (prefers-reduced-motion:reduce){
:host{
--_duration-fast:0.01ms;
--_duration-base:0.01ms;
}
}
`,V=b`
:host{
color:var(--violet-color-text-primary,#181b1a);
font-family:var(--violet-font-family,var(--violet-font-family-body));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_field-border:var(--violet-color-field-border,#869089);

--_field-border-readonly:var(--violet-color-border-strong,#6b7d6e);
--_field-border-hover:var(--violet-color-field-border-hover,#48534b);
--_field-border-focus:var(--violet-color-field-border-focus,var(--_focus-ring));
--_field-background:var(--violet-color-field-background,#ffffff);
--_field-background-readonly:var(--violet-color-field-background-readonly,var(--_surface-subtle));
--_field-text:var(--violet-color-field-text,var(--violet-color-text-primary,#181b1a));
--_field-placeholder:var(--violet-color-field-placeholder,var(--_text-muted));
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_danger-border:var(--violet-color-field-border-invalid,#c42a1a);
--_danger-text:var(--violet-color-state-danger-text,#c42a1a);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_radius-md:var(--violet-radius-control,8px);
--_radius-lg:var(--violet-radius-floating,12px);
--_radius-round:var(--violet-radius-round,9999px);
--_shadow-control:var(--violet-shadow-control,0 0 0 1px rgba(24,27,26,0.05),0 1px 2px rgba(24,27,26,0.10));
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));






--_shadow-well:var(--violet-shadow-well,inset 0 2px 3px -1px rgba(0,0,0,0.1));
--_field-shadow:inset 0 1px 0 var(--_field-border),var(--_shadow-well);
--_field-shadow-hover:inset 0 1px 0 var(--_field-border-hover),var(--_shadow-well);
--_field-shadow-focus:
0 0 0 calc(var(--violet-size-focus-ring-width,2px) - 1px) var(--_field-border-focus),
0 0 0 4px color-mix(in srgb,var(--_focus-ring) 20%,transparent);
--_layer-base:var(--violet-z-index-base,0);
--_layer-raised:var(--violet-z-index-raised,1);
--_layer-sticky:var(--violet-z-index-sticky,10);
--_layer-overlay:var(--violet-z-index-overlay,100);
--_layer-popover:var(--violet-z-index-popover,200);
--_layer-modal:var(--violet-z-index-modal,300);
--_layer-toast:var(--violet-z-index-toast,400);
--_space-stack-xs:var(--violet-space-stack-tight,4px);
--_space-stack-sm:var(--violet-space-stack-group,8px);
--_space-stack-2xs:calc(var(--_space-stack-xs) / 2);

--_space-field-gap:calc(var(--_space-stack-xs) + var(--_space-stack-2xs));
--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_space-inline-md:var(--violet-space-inline-group,8px);
--_type-label-size:var(--violet-type-label-size,13px);
--_type-label-line:var(--violet-type-label-line,16px);
--_type-label-weight:var(--violet-type-label-weight,500);
--_type-body-size:var(--violet-type-body-size,14px);
--_type-body-line:var(--violet-type-body-line,20px);
--_type-caption-size:var(--violet-type-caption-size,12px);
--_type-caption-line:var(--violet-type-caption-line,16px);
--_type-label-size-compact:calc(var(--_type-label-size) - 1px);
--_type-body-size-compact:calc(var(--_type-body-size) - 1px);
--_type-caption-size-compact:calc(var(--_type-caption-size) - 1px);
--_target-size-compact:var(--violet-size-target-compact,24px);
--_target-size-natural:var(--violet-size-target-natural,32px);
--_target-size-comfortable:var(--violet-size-target-comfortable,44px);
--_auto-target-size:var(--_target-size-natural);
--_target-size:var(--violet-target-size,var(--_auto-target-size));
--_control-label-size:var(--violet-control-label-size,var(--_type-label-size));
--_control-body-size:var(--violet-control-body-size,var(--_type-body-size));
--_control-caption-size:var(--violet-control-caption-size,var(--_type-caption-size));
--_duration-fast:var(--violet-duration-fast,120ms);
--_duration-base:var(--violet-duration-base,180ms);
--_easing-standard:var(--violet-easing-standard,cubic-bezier(0.2,0,0,1));
}

@media (any-pointer:coarse){
:host{
--_auto-target-size:var(--_target-size-comfortable);
}
}
@media (prefers-reduced-motion:reduce){
:host{
--_duration-fast:0.01ms;
--_duration-base:0.01ms;
}
}
`,A=b`
:host{
color:var(--violet-color-text-primary,#181b1a);
font-family:var(--violet-font-family,var(--violet-font-family-body));

--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_surface-hover:var(--violet-color-action-secondary-hover,rgba(24,27,26,0.11));
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_danger-border:var(--violet-color-state-danger-border,transparent);
--_success-border:var(--violet-color-state-success-border,transparent);
--_shadow-control:var(--violet-shadow-control,0 0 0 1px rgba(24,27,26,0.05),0 1px 2px rgba(24,27,26,0.10));
--_shadow-card:var(--violet-shadow-card,0 0 0 1px rgba(24,27,26,0.06),0 1px 2px rgba(24,27,26,0.06),0 4px 10px -2px rgba(24,27,26,0.06));
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_layer-base:var(--violet-z-index-base,0);
--_layer-raised:var(--violet-z-index-raised,1);
--_layer-sticky:var(--violet-z-index-sticky,10);
--_layer-overlay:var(--violet-z-index-overlay,100);
--_layer-popover:var(--violet-z-index-popover,200);
--_layer-modal:var(--violet-z-index-modal,300);
--_layer-toast:var(--violet-z-index-toast,400);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_radius-sm:var(--violet-radius-inset,4px);
--_radius-md:var(--violet-radius-control,8px);
--_radius-lg:var(--violet-radius-floating,12px);
--_radius-round:var(--violet-radius-round,9999px);
--_space-stack-xs:var(--violet-space-stack-tight,4px);
--_space-stack-sm:var(--violet-space-stack-group,8px);
--_space-stack-2xs:calc(var(--_space-stack-xs) / 2);
--_space-sm:var(--violet-space-inline-group,8px);
--_space-md:var(--violet-space-layout-panel,12px);
--_space-lg:var(--violet-space-layout-page,24px);
--_body-size:var(--violet-type-body-size,14px);
--_body-line:var(--violet-type-body-line,20px);
--_type-label-weight:var(--violet-type-label-weight,500);
--_caption-size:var(--violet-type-caption-size,12px);
--_caption-line:var(--violet-type-caption-line,16px);
--_meta-size:var(--violet-type-caption-size,12px);
--_duration-fast:var(--violet-duration-fast,120ms);
--_duration-base:var(--violet-duration-base,180ms);
--_easing-standard:var(--violet-easing-standard,cubic-bezier(0.2,0,0,1));
}
@media (prefers-reduced-motion:reduce){
:host{
--_duration-fast:0.01ms;
--_duration-base:0.01ms;
}
}
`;var _v=b`
    ${De}

:host{
display:inline-flex;
vertical-align:middle;
--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_space-stack-sm:var(--violet-space-stack-group,8px);
}

.control{
box-sizing:border-box;
display:inline-flex;
align-items:center;
justify-content:center;

align-self:flex-start;
inline-size:100%;
min-block-size:var(--_target-size);
min-inline-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));

padding-block:max(0px,calc((var(--_target-size) - var(--_type-body-line)) / 2 - 1px));
border:thin solid transparent;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
box-shadow:none;
cursor:pointer;
font-family:inherit;
font-size:var(--_control-type-size);
line-height:var(--_type-body-line);
font-weight:500;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:calc(var(--_space-inline-sm) / 2);
}


.control[data-appearance="primary"]{
background:var(--_action-primary-background);
color:var(--_action-primary-text);
box-shadow:var(--_shadow-control);
}

.control[data-appearance="primary"]:hover{
background:var(--_action-primary-hover);
}

.control[data-appearance="primary"]:active{
background:var(--_action-primary-pressed);
box-shadow:none;
}

.control[data-appearance="secondary"]{
background:var(--_action-secondary-background);
color:var(--_action-secondary-text);
border-color:var(--_action-secondary-border);
}

.control[data-appearance="secondary"]:hover{
background:var(--_action-secondary-hover);
}

.control[data-appearance="secondary"]:active{
background:var(--_action-secondary-pressed);
}


.control[data-appearance="quiet"]{
color:var(--_text-secondary);
background:transparent;
}

.control[data-appearance="quiet"]:hover{
background:var(--_action-secondary-background);
}

.control[data-appearance="quiet"]:active{
background:var(--_action-secondary-pressed);
}

.control[data-appearance="danger"]{
background:var(--_action-danger-background);
color:var(--_action-danger-text);
box-shadow:var(--_shadow-control);
}

.control[data-appearance="danger"]:hover{
background:var(--_action-danger-hover);
}

.control[data-appearance="danger"]:active{
background:var(--_action-danger-pressed);
box-shadow:none;
}

.control[disabled]{
opacity:0.5;
cursor:not-allowed;
box-shadow:none;
}

.label{
display:inline-flex;
align-items:center;
text-align:center;
}

slot[name="before"],
slot[name="after"]{
display:inline-flex;
align-items:center;
flex:0 0 auto;
}

::slotted([slot="before"]){
margin-inline-end:var(--_space-inline-sm);
}

::slotted([slot="after"]){
margin-inline-start:var(--_space-inline-sm);
}

.control[data-appearance="transparent"]{
color:var(--_text-secondary);
background:transparent;
}

.control[data-appearance="transparent"]:hover{
background:var(--_action-secondary-background);
}

.control[data-appearance="transparent"]:active{
background:var(--_action-secondary-pressed);
}
`,kv=h`
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
        aria-keyshortcuts="${t=>t.ariaKeyShortcuts}"
        aria-pressed="${t=>t.ariaPressed}"
    >
        <slot name="before" part="before"></slot>
        <span class="label" part="label"><slot></slot></span>
        <slot name="after" part="after"></slot>
    </button>
`,Cv={"aria-labelledby":"ariaLabelledby","aria-describedby":"ariaDescribedby","aria-errormessage":"ariaErrormessage","aria-controls":"ariaControls"},Sv={"aria-labelledby":"ariaLabelledByElements","aria-describedby":"ariaDescribedByElements","aria-errormessage":"ariaErrorMessageElements","aria-controls":"ariaControlsElements"},we=class extends y{constructor(){super(),this.appearance="primary",this.type="button",this.disabled=!1,this.ariaLabel=""}connectedCallback(){super.connectedCallback(),this.#e("aria-labelledby",this.ariaLabelledby),this.#e("aria-describedby",this.ariaDescribedby),this.#e("aria-errormessage",this.ariaErrormessage),this.#e("aria-controls",this.ariaControls)}ariaLabelledbyChanged(e,i){this.#e("aria-labelledby",i)}ariaDescribedbyChanged(e,i){this.#e("aria-describedby",i)}ariaErrormessageChanged(e,i){this.#e("aria-errormessage",i)}ariaControlsChanged(e,i){this.#e("aria-controls",i)}ariaExpandedChanged(e,i){this.#t("aria-expanded",i)}ariaHasPopupChanged(e,i){this.#t("aria-haspopup",i)}ariaKeyShortcutsChanged(e,i){this.#t("aria-keyshortcuts",i)}ariaPressedChanged(e,i){this.#t("aria-pressed",i)}#e(e,i,o=!1){let r=this.shadowRoot?.querySelector("button");if(!r)return;let n=this.getRootNode(),s=(i??"").split(/\s+/).filter(Boolean),a=n instanceof Document||n instanceof ShadowRoot?s.map(l=>n.getElementById(l)).filter(l=>l!==null):[];r[Sv[e]]=a.length>0?a:null,!o&&a.length<s.length&&M.enqueue(()=>{this[Cv[e]]===i&&this.#e(e,i,!0)})}#t(e,i){let o=this.shadowRoot?.querySelector("button");o&&(i==null?o.removeAttribute(e):o.setAttribute(e,i))}};c(we.prototype,"appearance");c(we.prototype,"type");c({mode:"boolean"})(we.prototype,"disabled");f(we.prototype,"ariaLabel");c({attribute:"aria-labelledby"})(we.prototype,"ariaLabelledby");c({attribute:"aria-describedby"})(we.prototype,"ariaDescribedby");c({attribute:"aria-errormessage"})(we.prototype,"ariaErrormessage");c({attribute:"aria-controls"})(we.prototype,"ariaControls");c({attribute:"aria-description"})(we.prototype,"ariaDescription");c({attribute:"aria-expanded"})(we.prototype,"ariaExpanded");c({attribute:"aria-haspopup"})(we.prototype,"ariaHasPopup");c({attribute:"aria-keyshortcuts"})(we.prototype,"ariaKeyShortcuts");c({attribute:"aria-pressed"})(we.prototype,"ariaPressed");var bc={name:"violet-button",template:kv,styles:_v,shadowOptions:{delegatesFocus:!0}};var Gr=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},zv=b`
    ${A}

:host{
display:block;
color:var(--_text-primary);
--_alert-radius:var(--violet-alert-radius,var(--_radius-lg));
--_alert-padding:var(--violet-alert-padding,var(--_space-md));
--_alert-gap:var(--violet-alert-gap,var(--_space-sm));
--_alert-icon-size:var(--violet-alert-icon-size,1rem);
--_alert-title-size:var(--violet-alert-title-size,var(--_body-size));
--_alert-title-line:var(--violet-alert-title-line,var(--_body-line));
--_alert-body-size:var(--violet-alert-body-size,var(--_body-size));
--_alert-body-line:var(--violet-alert-body-line,var(--_body-line));
--_alert-meta-size:var(--violet-alert-meta-size,var(--_caption-size));

--_alert-border:var(--violet-alert-border,transparent);
--_alert-surface:var(--violet-alert-surface,var(--_surface-subtle));
--_alert-emphasis:var(--violet-alert-emphasis,var(--_text-secondary));
--_alert-shadow:var(--violet-alert-shadow,none);
}

:host([tone="info"]){
--_alert-emphasis:var(--_text-secondary);
}

:host([tone="success"]){
--_alert-surface:var(--violet-color-state-success-background,#dfeae3);
--_alert-border:var(--violet-color-state-success-border,transparent);
--_alert-emphasis:var(--violet-color-state-success-text,#2c5e4b);
}

:host([tone="warning"]){
--_alert-surface:var(--violet-color-state-warning-background,#f3e8d2);
--_alert-border:var(--violet-color-state-warning-border,transparent);
--_alert-emphasis:var(--violet-color-state-warning-text,#92400E);
}

:host([tone="danger"]){
--_alert-surface:var(--violet-color-state-danger-background,#f7e4df);
--_alert-border:var(--violet-color-state-danger-border,transparent);
--_alert-emphasis:var(--violet-color-state-danger-text,#c42a1a);
}

.frame{
--violet-card-radius:var(--_alert-radius);
--violet-card-padding:var(--_alert-padding);
--violet-card-background:var(--_alert-surface);
--violet-card-border-color:var(--_alert-border);
--violet-card-shadow:var(--_alert-shadow);
}

.layout{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:start;
gap:var(--_alert-gap);
}


.leading{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:var(--_alert-icon-size);
block-size:var(--_alert-title-line);
color:var(--_alert-emphasis);
flex:0 0 auto;
}

.leading[hidden]{
display:none;
}

.leading ::slotted(violet-icon){
--violet-icon-size:var(--_alert-icon-size);
color:currentColor;
}

.icon-slot{
display:contents;
}

.body{
display:grid;
gap:var(--_space-stack-2xs);
min-inline-size:0;
font-size:var(--_alert-body-size);
line-height:var(--_alert-body-line);
}

.copy{
display:grid;
gap:var(--_space-stack-2xs);
min-inline-size:0;
}

.title{
margin:0;
color:var(--_alert-emphasis);
font-size:var(--_alert-title-size);
line-height:var(--_alert-title-line);
font-weight:500;
}

.title[hidden]{
display:none;
}

.content{
display:grid;
gap:var(--_space-stack-2xs);
color:var(--_text-primary);
}

.content slot::slotted(*){
margin:0;
}

.actions{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:var(--_space-sm);
margin-block-start:var(--_space-stack-xs);
}

.actions[hidden]{
display:none;
}

.actions slot::slotted(*){
margin:0;
}


.dismiss{
flex:0 0 auto;
margin-block-start:calc((var(--_alert-title-line) - var(--violet-size-target-natural,32px)) / 2);
margin-inline-end:calc(var(--_space-stack-xs) * -1);
color:var(--_alert-emphasis);
}

.dismiss[hidden]{
display:none;
}

@media (max-width:480px){
.layout{
grid-template-columns:auto minmax(0,1fr);
}

.actions[data-single-action] slot::slotted(*){
flex:1 1 100%;
inline-size:100%;
}

.dismiss{
grid-column:2;
justify-self:end;
margin-block-start:0;
}
}

@media (forced-colors:active){
.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:CanvasText;
}





.layout{
forced-color-adjust:none;
}

.title,
.content{
color:CanvasText;
}

.leading{
color:ButtonText;
}

slot{
forced-color-adjust:auto;
}
}
`,Ev=h`
    <violet-card class="frame" part="root" appearance="outline" padding="medium">
        <div class="layout" part="layout">
            <span class="leading" part="icon" ?hidden="${t=>!t.showLeading}">
                <slot class="icon-slot" name="icon" @slotchange="${t=>t.handleIconSlotChange()}"></slot>
                ${t=>t.hasIcon?h``:t.defaultIconTemplate}
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
                <div
                    class="actions"
                    part="actions"
                    ?hidden="${t=>!t.hasActions}"
                    ?data-single-action="${t=>t.hasSingleAction}"
                >
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
`,st=class extends y{constructor(){super(),this.hasTitle=!1,this.hasActions=!1,this.hasSingleAction=!1,this.hasIcon=!1,this.tone="default",this.announcement="off",this.dismissible=!1}connectedCallback(){ti(),mt(),We(),Ki(),super.connectedCallback(),this.handleTitleSlotChange(),this.handleActionsSlotChange(),this.handleIconSlotChange()}get showLeading(){return this.hasIcon||this.tone==="success"||this.tone==="warning"||this.tone==="danger"}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}get defaultIconTemplate(){return this.tone==="success"?h`<violet-icon icon="system/checkmark" decorative></violet-icon>`:this.tone==="danger"?h`<violet-icon icon="system/dismiss" decorative></violet-icon>`:this.tone==="warning"?h`<violet-icon icon="system/warning" decorative></violet-icon>`:h``}handleTitleSlotChange(){this.hasTitle=this.#e('slot[name="title"]')}handleActionsSlotChange(){let i=(this.shadowRoot?.querySelector('slot[name="actions"]')?.assignedNodes({flatten:!0})??[]).filter(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():o.nodeType===Node.ELEMENT_NODE);this.hasActions=i.length>0,this.hasSingleAction=i.length===1&&i[0]?.nodeType===Node.ELEMENT_NODE}handleIconSlotChange(){this.hasIcon=this.#e('slot[name="icon"]')}handleDismiss(){this.$emit("dismiss")}#e(e){return(this.shadowRoot?.querySelector(e)?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0)}};Gr([f],st.prototype,"hasTitle",void 0);Gr([f],st.prototype,"hasActions",void 0);Gr([f],st.prototype,"hasSingleAction",void 0);Gr([f],st.prototype,"hasIcon",void 0);c(st.prototype,"tone");c(st.prototype,"announcement");c({mode:"boolean"})(st.prototype,"dismissible");var yc={name:"violet-alert",template:Ev,styles:zv,shadowOptions:{delegatesFocus:!0}};var Tv=b`
    ${A}

:host{
display:inline-flex;

--_badge-bg:color-mix(in srgb,var(--_text-primary) 8%,transparent);
--_badge-text:var(--_text-secondary);
--_badge-padding-inline:var(--_space-md);
--_badge-min-block:1.25rem;
--_badge-font-size:var(--_caption-size);
--_badge-line-height:var(--_caption-line);
}

:host([size="sm"]){
--_badge-padding-inline:var(--_space-sm);
--_badge-min-block:1.125rem;
}

:host([size="md"]){
--_badge-padding-inline:var(--_space-md);
--_badge-min-block:1.25rem;
}

:host([size="lg"]){
--_badge-padding-inline:var(--_space-lg);
--_badge-min-block:1.5rem;
--_badge-font-size:var(--_body-size);
--_badge-line-height:var(--_body-line);
}

:host([color="accent"]){
--_badge-bg:var(--violet-color-accent-background,#dfecf4);
--_badge-text:var(--violet-color-accent-text,#1b5f80);
}

:host([color="success"]){
--_badge-bg:var(--violet-color-state-success-background,#dfeae3);
--_badge-text:var(--violet-color-state-success-text,#2c5e4b);
}

:host([color="warning"]){
--_badge-bg:var(--violet-color-state-warning-background,#f3e8d2);
--_badge-text:var(--violet-color-state-warning-text,#92400E);
}

:host([color="danger"]){
--_badge-bg:var(--violet-color-state-danger-background,#f7e4df);
--_badge-text:var(--violet-color-state-danger-text,#c42a1a);
}

.badge{
box-sizing:border-box;
display:inline-flex;
align-items:center;
justify-content:center;
gap:var(--_space-sm);
min-block-size:var(--_badge-min-block);
min-inline-size:var(--_badge-min-block);
padding-inline:var(--_badge-padding-inline);
border:1px solid transparent;
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_badge-bg);
color:var(--_badge-text);
font-size:var(--_badge-font-size);
font-weight:var(--_type-label-weight);
line-height:var(--_badge-line-height);
white-space:nowrap;
}


:host([appearance="outline"]) .badge{
background:transparent;
border-color:color-mix(in srgb,currentColor 45%,transparent);
}

:host([appearance="subtle"]) .badge{
background:color-mix(in srgb,var(--_badge-bg) 65%,transparent);
}

.content{
display:inline-flex;
align-items:center;
}

.content::slotted(*){
margin:0;
}

violet-icon{
--violet-icon-size:0.9em;
}


@media (forced-colors:active){
.badge,
:host([appearance]) .badge{
forced-color-adjust:none;
background:Canvas;
color:CanvasText;
border-color:ButtonText;
}
}
`,$v=h`
    <span class="badge" part="badge" aria-hidden="${t=>t.decorative?"true":"false"}">
        ${g(t=>!!t.icon,h`
                <violet-icon icon="${t=>t.icon}" decorative="true" part="icon"></violet-icon>
            `)}
        <span class="content" part="content">
            <slot></slot>
        </span>
    </span>
`,bt=class extends y{constructor(){super(),this.label="",this.appearance="filled",this.color="neutral",this.size="md",this.decorative=!1,this.icon=""}connectedCallback(){super.connectedCallback(),this.syncAccessibilityState()}decorativeChanged(){this.syncAccessibilityState()}labelChanged(){this.syncAccessibilityState()}syncAccessibilityState(){if(this.decorative){this.setAttribute("aria-hidden","true"),this.removeAttribute("aria-label"),this.removeAttribute("role");return}this.removeAttribute("aria-hidden");let e=(this.label??"").trim();if(e){this.setAttribute("role","img"),this.setAttribute("aria-label",e);return}this.removeAttribute("role"),this.removeAttribute("aria-label")}};c(bt.prototype,"appearance");c(bt.prototype,"color");c(bt.prototype,"size");c({mode:"boolean"})(bt.prototype,"decorative");c(bt.prototype,"icon");c(bt.prototype,"label");var xc={name:"violet-badge",template:$v,styles:Tv};var wc=0,Iv=b`
    ${A}

:host{
display:block;

--_target-size-natural:var(--violet-size-target-natural,32px);
--_target-size-comfortable:var(--violet-size-target-comfortable,44px);
--_auto-target-size:var(--_target-size-natural);
--_target-size:var(--violet-target-size,var(--_auto-target-size));
--_control-body-size:var(--violet-control-body-size,var(--_body-size));
--_accordion-item-border-width:var(--violet-accordion-item-border-width,1px);
--_accordion-item-border-color:var(--violet-accordion-item-border-color,var(--_border-subtle));
--_accordion-item-background:var(--violet-accordion-item-background,transparent);
--_accordion-item-background-hover:var(--violet-accordion-item-background-hover,var(--_surface-subtle));
--_accordion-item-background-expanded:var(--violet-accordion-item-background-expanded,transparent);
--_accordion-item-padding-inline:var(--violet-accordion-item-padding-inline,var(--_space-md));

--_accordion-item-padding-block:var(
--violet-accordion-item-padding-block,
calc((var(--_target-size) + var(--_space-sm) - var(--_body-line)) / 2)
);
--_accordion-item-gap:var(--violet-accordion-item-gap,var(--_space-sm));
}


.item{
border-block-start:var(--_accordion-item-border-width) solid var(--_accordion-item-border-color);
background:var(--_accordion-item-background);
overflow:clip;
}

:host(:first-of-type) .item{
border-block-start-width:0;
}

.heading{
margin:0;
}

.trigger{
box-sizing:border-box;
display:flex;
align-items:center;
justify-content:space-between;
gap:var(--_accordion-item-gap);
inline-size:100%;
min-block-size:var(--_target-size);
padding:var(--_accordion-item-padding-block) var(--_accordion-item-padding-inline);
border:0;
background:transparent;
color:inherit;
cursor:pointer;
font:inherit;
text-align:start;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard);
}

.trigger:hover{
background:var(--_accordion-item-background-hover);
}

.trigger:focus-visible{
outline:none;
box-shadow:inset 0 0 0 2px var(--_focus-ring);
}

:host([expanded]) .trigger{
background:var(--_accordion-item-background-expanded);
}

:host([disabled]) .trigger{
color:var(--_text-muted);
cursor:not-allowed;
opacity:0.7;
}

.heading-content{
min-inline-size:0;
font-size:var(--_control-body-size);
font-weight:var(--_type-label-weight);
line-height:var(--_body-line);
}

.indicator{
inline-size:0.4375rem;
block-size:0.4375rem;
flex:0 0 auto;
margin-inline-end:2px;
border-inline-end:1.5px solid currentColor;
border-block-end:1.5px solid currentColor;
color:var(--_text-muted);
transform:rotate(45deg);
transition:transform var(--_duration-fast) var(--_easing-standard);
}

:host([expanded]) .indicator{
transform:rotate(225deg);
}

.panel{
background:var(--_accordion-item-background-expanded);
}

.panel[hidden]{
display:none;
}

.panel-content{
padding:0 var(--_accordion-item-padding-inline) var(--_space-md);
color:var(--_text-secondary);
font-size:var(--_control-body-size);
line-height:var(--_body-line);
}

@media (any-pointer:coarse){
:host{
--_auto-target-size:var(--_target-size-comfortable);
}
}

@media (forced-colors:active){
.item{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
}

.trigger:focus-visible{
box-shadow:inset 0 0 0 2px Highlight;
}
}
`,Av=h`
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
`,Ci=class extends y{constructor(){super();let e=wc;wc+=1,this.expanded=!1,this.disabled=!1,this.headingLevel=3,this.panelId=`violet-accordion-panel-${e}`,this.buttonId=`violet-accordion-button-${e}`}focusTrigger(){this.triggerElement?.focus()}handleTriggerClick(){this.disabled||this.$emit("toggle-request",{expanded:!this.expanded})}get triggerElement(){return this.shadowRoot?.querySelector(".trigger")??null}};c({mode:"boolean"})(Ci.prototype,"expanded");c({mode:"boolean"})(Ci.prototype,"disabled");c({attribute:"heading-level",converter:{fromView:t=>{let e=Number.parseInt(t,10);return Number.isFinite(e)&&e>=1&&e<=6?e:3},toView:t=>String(t)}})(Ci.prototype,"headingLevel");var _c={name:"violet-accordion-item",template:Av,styles:Iv,shadowOptions:{delegatesFocus:!0}};var Rv=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Dv=b`
    ${A}

:host{
display:block;
}


.root{
display:block;
border-radius:var(--_radius-lg);
background:var(--_surface-card);
box-shadow:var(--_shadow-control);
overflow:clip;
}

@media (forced-colors:active){
.root{
outline:1px solid ButtonText;
outline-offset:-1px;
}
}
`,Fv=h`
    <div class="root" part="root" @keydown="${(t,e)=>t.handleKeydown(e.event)}">
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </div>
`,Ji=class extends y{constructor(){super(),this.slottedItems=[],this.expandMode="multi"}connectedCallback(){super.connectedCallback(),this.addEventListener("toggle-request",this.handleToggleRequest),this.syncItems()}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("toggle-request",this.handleToggleRequest)}handleSlotChange(){let e=this.shadowRoot?.querySelector("slot");this.slottedItems=e?.assignedElements({flatten:!0})??[],this.syncItems()}handleToggleRequest(e){let i=e.target;if(!(i instanceof HTMLElement)||!this.items.includes(i))return;let o=e.detail?.expanded??!i.hasAttribute("expanded");if(this.expandMode==="single"&&o)for(let r of this.items)r!==i&&(r.expanded=!1);i.expanded=o,this.$emit("change",{item:i,expanded:o})}handleKeydown(e){let i=e.composedPath().find(n=>n instanceof HTMLElement&&n.tagName.toLowerCase()==="violet-accordion-item");if(!i)return!0;let o=this.items.filter(n=>!n.disabled),r=o.indexOf(i);if(r<0)return!0;switch(e.key){case"ArrowDown":case"ArrowRight":return e.preventDefault(),o[(r+1)%o.length]?.focusTrigger(),!1;case"ArrowUp":case"ArrowLeft":return e.preventDefault(),o[(r-1+o.length)%o.length]?.focusTrigger(),!1;case"Home":return e.preventDefault(),o[0]?.focusTrigger(),!1;case"End":return e.preventDefault(),o.at(-1)?.focusTrigger(),!1}return!0}get items(){return Array.from(this.querySelectorAll("violet-accordion-item")).filter(e=>e.closest("violet-accordion")===this)}syncItems(){let e=this.items;this.expandMode==="single"&&e.filter(o=>o.expanded).slice(1).forEach(o=>{o.expanded=!1})}};Rv([f],Ji.prototype,"slottedItems",void 0);c({attribute:"expand-mode"})(Ji.prototype,"expandMode");var kc={name:"violet-accordion",template:Fv,styles:Dv};var Mv=new Set(["http:","https:","mailto:"]),Vv="http://violet.invalid/";function Yr(t){if(!t)return!1;try{return Mv.has(new URL(t,Vv).protocol)}catch{return!1}}var Ov=b`
    ${A}

:host{
display:inline-flex;
align-items:center;
gap:0;
color:var(--_text-secondary);
font-size:var(--_caption-size);
line-height:var(--_caption-line);
}

.link,
.label,
.current{
display:inline-flex;
align-items:center;
min-inline-size:0;
color:inherit;
font:inherit;
text-decoration:none;
}

.link{
border-radius:var(--_radius-sm);
transition:
color var(--_duration-fast) var(--_easing-standard),
background-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard);
}

.link:hover{
color:var(--_text-primary);
background:var(--_surface-hover);
}

.link:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}

.current{
color:var(--_text-primary);
font-weight:500;
}

.separator{
color:var(--_text-muted);
margin-inline:var(--_space-stack-2xs);
}

:host([current]) .separator{
display:none;
}
`,Lv=h`
    ${t=>t.current?h`
                  <span class="current" part="current" aria-current="page">
                      <slot></slot>
                  </span>
              `:Yr(t.href)?h`
                    <a class="link" part="link" href="${e=>e.href}">
                        <slot></slot>
                    </a>
                `:h`
                  <span class="label" part="label">
                      <slot></slot>
                  </span>
              `}
    <span class="separator" part="separator" aria-hidden="true">
        <slot name="separator">/</slot>
    </span>
`,Zi=class extends y{#e;constructor(){super(),this.#e=this.attachInternals(),this.href="",this.current=!1}connectedCallback(){super.connectedCallback(),this.#t()}currentChanged(){this.#t()}#t(){this.#e.role="listitem",this.#e.ariaCurrent=this.current?"page":null,this.$fastController.isConnected&&(this.setAttribute("role","listitem"),this.current?this.setAttribute("aria-current","page"):this.removeAttribute("aria-current"))}};c(Zi.prototype,"href");c({mode:"boolean"})(Zi.prototype,"current");var Cc={name:"violet-breadcrumb-item",template:Lv,styles:Ov};var Pv=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Bv=b`
    ${A}

:host{
display:block;
}

.nav{
display:block;
}

.list{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:0;
margin:0;
padding:0;
list-style:none;
}
`,Nv=h`
    <nav class="nav" part="nav" aria-label="${t=>t.label||"Breadcrumb"}">
        <div class="list" part="list" role="list">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
    </nav>
`,eo=class extends y{constructor(){super(),this.items=[]}connectedCallback(){super.connectedCallback(),this.#o(),this.handleSlotChange()}handleSlotChange(){this.items=this.#e(),this.#t()}labelChanged(){this.#o()}#e(){return Array.from(this.querySelectorAll("violet-breadcrumb-item")).filter(e=>e.closest("violet-breadcrumb")===this)}#t(){let e=this.items.filter(o=>o.current),i=e[e.length-1]??this.items[this.items.length-1]??null;this.items.forEach(o=>{o.current=o===i})}#o(){this.ariaLabel=this.label||"Breadcrumb"}};Pv([f],eo.prototype,"items",void 0);c(eo.prototype,"label");var Sc={name:"violet-breadcrumb",template:Nv,styles:Bv};var zc=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Hv=b`
    ${A}

:host{
display:block;

--_card-border-width:1px;
--_card-padding:var(--violet-card-padding,0);
--_card-radius:var(--violet-card-radius,var(--_radius-lg));
--_card-background:var(--violet-card-background,var(--_surface-card));
--_card-band-background:var(--violet-card-band-background,var(--_surface-subtle));
--_card-border-color:var(--violet-card-border-color,transparent);
--_card-shadow:var(--violet-card-shadow,var(--_shadow-card));
}

:host([padding="small"]){
--_card-padding:var(--violet-card-padding,var(--_space-sm));
}

:host([padding="medium"]){
--_card-padding:var(--violet-card-padding,var(--_space-md));
}

:host([padding="large"]){
--_card-padding:var(--violet-card-padding,var(--_space-lg));
}


:host([appearance="outline"]){
--_card-shadow:var(--violet-card-shadow,var(--_shadow-control));
}

:host([appearance="subtle"]){
--_card-background:var(--violet-card-background,var(--_surface-subtle));
--_card-border-color:var(--violet-card-border-color,transparent);
--_card-shadow:var(--violet-card-shadow,none);
}

.root{
box-sizing:border-box;
display:flex;
flex-direction:column;
border:var(--_card-border-width) solid var(--_card-border-color);
border-radius:var(--_card-radius);
background:var(--_card-background);
box-shadow:var(--_card-shadow);
overflow:hidden;
transition:box-shadow var(--_duration-base) var(--_easing-standard);
}

:host([orientation="horizontal"]) .root{
flex-direction:row;
}

:host([interactive]) .root{
cursor:pointer;
}

:host([interactive]) .root:hover{
box-shadow:
var(--_card-shadow),
0 0 0 1px var(--_border-subtle);
}

:host([interactive]:focus-visible) .root{
box-shadow:
var(--_card-shadow),
0 0 0 2px var(--_focus-ring);
}


.header,
.footer{
padding:var(--_card-padding);
background:var(--_card-band-background);
}

.header[hidden]{
display:none;
}

.header:not([hidden]) + .body{
border-block-start:var(--_card-border-width) solid var(--_border-subtle);
}

.body{
display:flex;
flex-direction:column;
padding:var(--_card-padding);
flex:1;
}

:host([orientation="horizontal"]) .body{
flex-direction:row;
}

.footer[hidden]{
display:none;
}

.footer:not([hidden]){
border-block-start:var(--_card-border-width) solid var(--_border-subtle);
}

@media (forced-colors:active){

.root{
forced-color-adjust:none;
border:var(--_card-border-width) solid ButtonText;
background:Canvas;
box-shadow:none;
color:CanvasText;
}

slot{
forced-color-adjust:auto;
}

.header,
.footer{
background:Canvas;
}

.header:not([hidden]) + .body{
border-block-start-color:ButtonText;
}

.footer:not([hidden]){
border-block-start-color:ButtonText;
}
}
`,jv=h`
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
`,yt=class extends y{constructor(){super(),this.hasHeader=!1,this.hasFooter=!1,this.padding="none",this.appearance="filled",this.interactive=!1,this.orientation="vertical"}connectedCallback(){super.connectedCallback(),this.handleHeaderSlotChange(),this.handleFooterSlotChange(),this.#e()}interactiveChanged(){this.$fastController.isConnected&&this.#e()}handleHeaderSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="header"]');this.hasHeader=!!this.querySelector('[slot="header"]')||(e?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0);let i=this.shadowRoot?.querySelector(".header");i&&(i.hidden=!this.hasHeader)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=!!this.querySelector('[slot="footer"]')||(e?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0);let i=this.shadowRoot?.querySelector(".footer");i&&(i.hidden=!this.hasFooter)}#e(){this.interactive?(this.hasAttribute("tabindex")||this.setAttribute("tabindex","0"),this.hasAttribute("role")||this.setAttribute("role","group")):(this.getAttribute("tabindex")==="0"&&this.removeAttribute("tabindex"),this.getAttribute("role")==="group"&&this.removeAttribute("role"))}};zc([f],yt.prototype,"hasHeader",void 0);zc([f],yt.prototype,"hasFooter",void 0);c(yt.prototype,"padding");c(yt.prototype,"appearance");c({mode:"boolean"})(yt.prototype,"interactive");c(yt.prototype,"orientation");var Ec={name:"violet-card",template:jv,styles:Hv,shadowOptions:{delegatesFocus:!0}};function qv(t){return getComputedStyle(t).direction==="rtl"}function fe(t,e){return t!=="ArrowLeft"&&t!=="ArrowRight"||!qv(e)?t:t==="ArrowLeft"?"ArrowRight":"ArrowLeft"}function Ht(t,e,i){return new Date(t,e,i,12,0,0,0)}function Fe(t){if(!t)return null;let e=/^(\d{4})-(\d{2})-(\d{2})$/.exec(t.trim());if(!e)return null;let i=Number(e[1]),o=Number(e[2]),r=Number(e[3]),n=Ht(i,o-1,r);return Number.isNaN(n.getTime())||n.getFullYear()!==i||n.getMonth()!==o-1||n.getDate()!==r?null:n}function ai(t){let e=t.getFullYear(),i=String(t.getMonth()+1).padStart(2,"0"),o=String(t.getDate()).padStart(2,"0");return`${e}-${i}-${o}`}function xt(t,e){let i=Ht(t.getFullYear(),t.getMonth(),t.getDate());return i.setDate(i.getDate()+e),Ht(i.getFullYear(),i.getMonth(),i.getDate())}function to(t,e){let i=t.getFullYear(),o=t.getMonth(),r=Ht(i,o+e,1),n=Math.min(t.getDate(),Kv(r.getFullYear(),r.getMonth()));return Ht(r.getFullYear(),r.getMonth(),n)}function Cs(t,e){return to(t,e*12)}function Wv(t){return Ht(t.getFullYear(),t.getMonth(),1)}function Kv(t,e){return Ht(t,e+1,0).getDate()}function Tc(t,e,i){let o=ai(t);return e&&o<e?Fe(e)??t:i&&o>i?Fe(i)??t:t}function $c(t,e){return t.localeCompare(e)}function Ic(t,e){if(typeof e=="number"&&e>=0&&e<=6)return e;try{let o=new Intl.Locale(t||"en-US").getWeekInfo?.();if(o&&typeof o.firstDay=="number")return o.firstDay%7}catch{}return 0}function Ac(t,e){let i=new Intl.DateTimeFormat(t||void 0,{weekday:"short"}),o=new Intl.DateTimeFormat(t||void 0,{weekday:"long"}),r=Ht(2026,0,4);return Array.from({length:7},(n,s)=>{let a=xt(r,(e+s)%7);return{short:i.format(a),long:o.format(a)}})}function Rc(t,e){return new Intl.DateTimeFormat(t||void 0,{month:"long",year:"numeric"}).format(e)}function Xo(t,e){let i=Fe(e);return i?new Intl.DateTimeFormat(t||void 0,{dateStyle:"medium"}).format(i):e}function Dc(t){let{locale:e,monthDate:i,weekStartDay:o,value:r="",start:n="",end:s="",focused:a="",min:l="",max:d="",disabledDate:u=null}=t,p=Wv(i),v=(p.getDay()-o+7)%7,k=xt(p,-v),S=ai(Ht(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()));return Array.from({length:6},(R,F)=>Array.from({length:7},(_,$)=>{let D=xt(k,F*7+$),O=ai(D),L=!!(l&&O<l||d&&O>d||u?.(O)),P=!!(n&&s&&O>=n&&O<=s),W=r===O||n===O||s===O;return{iso:O,label:new Intl.DateTimeFormat(e||void 0,{day:"numeric"}).format(D),day:D.getDate(),currentMonth:D.getMonth()===i.getMonth(),disabled:L,selected:W,rangeStart:n===O,rangeEnd:s===O,inRange:P,today:S===O,tabIndex:a?a===O?0:-1:r===O?0:-1}}))}function Ss(t){if(!t)return null;let e=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());if(!e)return null;let i=Number(e[1]),o=Number(e[2]),r=Number(e[3]??"0");return i>23||o>59||r>59?null:{hour:i,minute:o,second:r}}var zs=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Uv=b`
    ${A}

:host{
display:grid;
inline-size:min(100%,var(--violet-calendar-inline-size,18rem));
color:var(--_text-primary);
--_calendar-radius:var(--_radius-lg);
--_calendar-background:var(--violet-calendar-background,var(--_surface-card));
--_calendar-shadow:var(--violet-calendar-shadow,var(--_shadow-card));
--_calendar-cell-size:clamp(2rem,6vw,2.25rem);
--_calendar-accent:var(--violet-color-control-selected-foreground,#1b5f80);
--_calendar-accent-soft:color-mix(in srgb,var(--_calendar-accent) 16%,transparent);
--_calendar-selected-background:var(--violet-color-control-selected-background,#c0daeb);
--_calendar-selected-border:var(--violet-color-control-selected-border,rgba(27,95,128,0.5));
}

.root{
display:grid;
gap:var(--_space-md);
padding:var(--_space-md);

border:1px solid transparent;
border-radius:var(--_calendar-radius);
background:var(--_calendar-background);
box-shadow:var(--_calendar-shadow);
}

.header{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-sm);
}

.heading{
justify-self:center;
font-size:var(--_body-size);
font-weight:500;
line-height:var(--_body-line);
}

.nav{
box-sizing:border-box;
display:inline-grid;
place-items:center;
inline-size:var(--_calendar-cell-size);
block-size:var(--_calendar-cell-size);
border:1px solid transparent;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
font:inherit;
cursor:pointer;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
background-color var(--_duration-fast) var(--_easing-standard);
}

.nav:hover{
background:var(--_surface-hover);
}

.weekday-row,
.week{
display:grid;
grid-template-columns:repeat(7,minmax(0,1fr));
gap:2px;
}

.weekday{
display:grid;
place-items:center;
block-size:calc(var(--_calendar-cell-size) * 0.75);
color:var(--_text-muted);
font-size:var(--_caption-size);
line-height:var(--_caption-line);
}

.day-cell{
display:grid;
}

.day-cell.range{
background:var(--_calendar-accent-soft);
}

.day-button{
box-sizing:border-box;
display:inline-grid;
place-items:center;
inline-size:100%;
block-size:var(--_calendar-cell-size);
padding:0;
border:1px solid transparent;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
cursor:pointer;
font:inherit;
font-size:var(--_body-size);
font-variant-numeric:tabular-nums;
line-height:1;
}

.day-button.current-month{
color:var(--_text-primary);
}

.day-button.other-month{
color:var(--_text-muted);
}

.day-button:hover:not(:disabled){
background:color-mix(in srgb,var(--_calendar-accent) 10%,transparent);
}


.day-button.selected,
.day-button.range-start,
.day-button.range-end{
background:var(--_calendar-selected-background);
color:var(--_calendar-accent);
box-shadow:inset 0 0 0 1px var(--_calendar-selected-border);
font-weight:500;
}


.nav:focus-visible,
.day-button:focus-visible{
outline:none;
border-color:color-mix(in srgb,var(--_focus-ring) 48%,var(--_border-subtle));
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 35%,transparent);
}

.day-button.today:not(.selected):not(.range-start):not(.range-end){
border-color:color-mix(in srgb,var(--_calendar-accent) 35%,transparent);
}

.day-button:disabled{
cursor:not-allowed;
opacity:0.45;
}

@media (forced-colors:active){
.root,
.nav,
.day-button{
forced-color-adjust:none;
background:Canvas;
color:CanvasText;
border-color:ButtonText;
box-shadow:none;
}

.day-button.selected,
.day-button.range-start,
.day-button.range-end{
background:Highlight;
color:HighlightText;
border-color:Highlight;
box-shadow:none;
}

.day-cell.range{
background:Canvas;
}
}
`,Gv=h`
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
            ${N(t=>t.weekdayLabels,h`
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
            ${N(t=>t.weeks,h`
                    <div class="week" part="week" role="row">
                        ${N(t=>t,h`
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
`,$e=class extends y{constructor(){super(),this.disabledDates=null,this.locale="",this.selectionMode="single",this.value="",this.start="",this.end="",this.min="",this.max="",this.disabled=!1,this.weekStartDay=-1;let e=new Date;this.monthDate=new Date(e.getFullYear(),e.getMonth(),1,12,0,0,0),this.focusedDate=ai(new Date(e.getFullYear(),e.getMonth(),e.getDate(),12,0,0,0))}connectedCallback(){super.connectedCallback(),this.#e(),this.#t()}get resolvedLocale(){return this.locale||document.documentElement.lang||navigator.language||"en-US"}get resolvedWeekStartDay(){return Ic(this.resolvedLocale,this.weekStartDay>=0?this.weekStartDay:void 0)}get weekdayLabels(){return Ac(this.resolvedLocale,this.resolvedWeekStartDay)}get monthLabel(){return Rc(this.resolvedLocale,this.monthDate)}get weeks(){return Dc({locale:this.resolvedLocale,monthDate:this.monthDate,weekStartDay:this.resolvedWeekStartDay,value:this.selectionMode==="single"?this.value:"",start:this.selectionMode==="range"?this.start:"",end:this.selectionMode==="range"?this.end:"",focused:this.focusedDate,min:this.min,max:this.max,disabledDate:this.disabled?()=>!0:this.disabledDates})}valueChanged(){this.selectionMode==="single"&&(this.#e(),this.#t())}startChanged(){this.selectionMode==="range"&&(this.#e(),this.#t())}endChanged(){this.selectionMode==="range"&&this.#t()}localeChanged(){this.$emit("locale-change",{locale:this.resolvedLocale})}showPreviousMonth(){this.monthDate=to(this.monthDate,-1),this.#o()}showNextMonth(){this.monthDate=to(this.monthDate,1),this.#o()}handleDayFocus(e){this.focusedDate=e}handleDayFocusEvent(e){let o=e.currentTarget?.getAttribute("data-date")??"";o&&this.handleDayFocus(o)}handleGridFocusIn(e){let o=e.target?.closest("[data-date]")?.getAttribute("data-date")??"";o&&this.handleDayFocus(o)}handleDaySelect(e){if(!(this.disabled||this.#r(e))){if(this.selectionMode==="range"){!this.start||this.start&&this.end?(this.start=e,this.end=""):$c(e,this.start)<0?(this.start=e,this.end=""):this.end=e,this.focusedDate=e,this.$emit("input",{start:this.start||null,end:this.end||null}),this.$emit("change",{start:this.start||null,end:this.end||null});return}this.value=e,this.focusedDate=e,this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value})}}handleDaySelectEvent(e){let o=e.currentTarget?.getAttribute("data-date")??"";o&&this.handleDaySelect(o)}handleGridClick(e){let o=e.target?.closest("[data-date]")?.getAttribute("data-date")??"";o&&this.handleDaySelect(o)}handleGridKeydown(e){if(this.disabled)return!0;let i=Fe(this.focusedDate)??Fe(this.value)??Fe(this.start)??new Date,o=null;switch(fe(e.key,this)){case"ArrowLeft":o=xt(i,-1);break;case"ArrowRight":o=xt(i,1);break;case"ArrowUp":o=xt(i,-7);break;case"ArrowDown":o=xt(i,7);break;case"Home":o=xt(i,-((i.getDay()-this.resolvedWeekStartDay+7)%7));break;case"End":o=xt(i,6-(i.getDay()-this.resolvedWeekStartDay+7)%7);break;case"PageUp":o=e.shiftKey?Cs(i,-1):to(i,-1);break;case"PageDown":o=e.shiftKey?Cs(i,1):to(i,1);break;case"Enter":case" ":return e.preventDefault(),this.handleDaySelect(this.focusedDate),!1;default:return!0}e.preventDefault();let r=Tc(o??i,this.min,this.max);return this.focusedDate=ai(r),this.monthDate=new Date(r.getFullYear(),r.getMonth(),1,12,0,0,0),requestAnimationFrame(()=>this.#i()),!1}#e(){let e=Fe(this.selectionMode==="range"?this.start:this.value);e&&(this.monthDate=new Date(e.getFullYear(),e.getMonth(),1,12,0,0,0))}#t(){let e=this.selectionMode==="range"?this.end||this.start:this.value;if(e){this.focusedDate=e;return}if(!Fe(this.focusedDate)){let i=new Date;this.focusedDate=ai(new Date(i.getFullYear(),i.getMonth(),i.getDate(),12,0,0,0))}}#o(){let e=Fe(this.focusedDate);e&&((e.getMonth()!==this.monthDate.getMonth()||e.getFullYear()!==this.monthDate.getFullYear())&&(this.focusedDate=ai(new Date(this.monthDate.getFullYear(),this.monthDate.getMonth(),1,12,0,0,0))),requestAnimationFrame(()=>this.#i()))}#i(){this.shadowRoot?.querySelector(`[data-date="${this.focusedDate}"]`)?.focus()}#r(e){return!!(this.min&&e<this.min||this.max&&e>this.max||this.disabledDates?.(e))}};zs([f],$e.prototype,"monthDate",void 0);zs([f],$e.prototype,"focusedDate",void 0);zs([f],$e.prototype,"weekStartDay",void 0);c({attribute:"selection-mode"})($e.prototype,"selectionMode");c($e.prototype,"locale");c($e.prototype,"value");c($e.prototype,"start");c($e.prototype,"end");c($e.prototype,"min");c($e.prototype,"max");c({mode:"boolean"})($e.prototype,"disabled");var Fc={name:"violet-calendar",template:Gv,styles:Uv};var Yv=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Vc={fromView(t){let e=Number.parseInt(t,10);return Number.isFinite(e)?e:0},toView(t){return String(t)}};function Mc(t,e,i){let o=t.getAttribute(e);if(!o)return i;let r=Number.parseInt(o,10);return Number.isFinite(r)?r:i}var Xv=b`
    ${A}

:host{
display:block;
min-inline-size:0;
color:var(--_text-primary);

--_carousel-gap:var(--_space-md);
--_carousel-slide-gap:var(--_space-sm);
--_carousel-slides-per-view:1;
--_carousel-radius:calc(var(--_radius-md) * 2);
--_carousel-surface:var(--_surface-card);
--_carousel-border:var(--_border-subtle);
--_carousel-shadow:var(--_shadow-card);
--_carousel-dot-size:0.625rem;

--_target-size-natural:var(--violet-size-target-natural,32px);
--_target-size-comfortable:var(--violet-size-target-comfortable,44px);
--_auto-target-size:var(--_target-size-natural);
--_target-size:var(--violet-target-size,var(--_auto-target-size));
--_carousel-dot-target-size:calc(var(--_target-size) * 0.75);
--_carousel-dot-active:var(--violet-color-state-success-foreground,#2c5e4b);
--_carousel-dot-idle:color-mix(in srgb,var(--_text-muted) 32%,transparent);
}

:host([appearance="plain"]){
--_carousel-surface:transparent;
--_carousel-border:transparent;
--_carousel-shadow:none;
}

.root{
display:grid;
gap:var(--_carousel-gap);
}

.viewport{
box-sizing:border-box;
overflow-x:auto;
overflow-y:hidden;
min-inline-size:0;
border:1px solid var(--_carousel-border);
border-radius:var(--_carousel-radius);
background:var(--_carousel-surface);
box-shadow:var(--_carousel-shadow);
scroll-behavior:smooth;
scroll-snap-type:x mandatory;
scrollbar-width:none;
overscroll-behavior-x:contain;
-webkit-overflow-scrolling:touch;
}

.viewport::-webkit-scrollbar{
display:none;
}

.viewport:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
}

.track{
display:block;
min-inline-size:0;
}

.slides{
display:flex;
gap:var(--_carousel-slide-gap);
min-inline-size:100%;
}

::slotted(*){
box-sizing:border-box;
flex:0 0 calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
min-inline-size:calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
inline-size:calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
scroll-snap-align:start;
scroll-snap-stop:always;
}

.controls{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-sm);
min-inline-size:0;
}

.controls[hidden],
.pagination[hidden],
.status[hidden]{
display:none;
}

.previous-button violet-icon{
transform:rotate(180deg);
}

.pagination{
display:flex;
align-items:center;
justify-content:center;
gap:var(--_space-sm);
min-inline-size:0;
flex-wrap:wrap;
}

.dot{
box-sizing:border-box;
inline-size:var(--_carousel-dot-target-size);
block-size:var(--_carousel-dot-target-size);
min-inline-size:var(--_carousel-dot-target-size);
min-block-size:var(--_carousel-dot-target-size);
padding:0;
border:0;
border-radius:var(--_radius-round);
background:transparent;
color:inherit;
display:inline-grid;
place-items:center;
cursor:pointer;
}

.dot::before{
content: "";
inline-size:var(--_carousel-dot-size);
block-size:var(--_carousel-dot-size);
border-radius:var(--_radius-round);
background:var(--_carousel-dot-idle);
transition:
transform var(--_duration-fast) var(--_easing-standard),
background-color var(--_duration-fast) var(--_easing-standard);
}

.dot:hover::before{
transform:scale(1.08);
}

.dot[aria-pressed="true"]::before{
background:var(--_carousel-dot-active);
transform:scale(1.2);
}

.dot:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
}

.sr-only{
position:absolute;
inline-size:1px;
block-size:1px;
padding:0;
margin:-1px;
overflow:hidden;
clip:rect(0 0 0 0);
white-space:nowrap;
border:0;
}

@media (any-pointer:coarse){
:host{
--_auto-target-size:var(--_target-size-comfortable);
--_carousel-dot-target-size:var(--_target-size);
}
}

@media (prefers-reduced-motion:reduce){
.viewport{
scroll-behavior:auto;
}
}

@media (forced-colors:active){
.viewport{
forced-color-adjust:none;
background:Canvas;
border-color:ButtonText;
box-shadow:none;
}

.dot::before{
background:GrayText;
}

.dot[aria-pressed="true"]::before{
background:Highlight;
}
}
`,Qv=h`
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
`,wt=class extends y{#e=!1;#t=!1;#o=0;constructor(){super(),this.slides=[],this.slideCount=0,this.appearance="framed",this.label="Carousel",this.activeIndex=0,this.slidesPerView=1,this.loop=!1}connectedCallback(){super.connectedCallback(),this.activeIndex=Mc(this,"active-index",this.activeIndex||0),this.slidesPerView=Mc(this,"slides-per-view",this.slidesPerView||1),requestAnimationFrame(()=>{this.isConnected&&(this.#e=!0,this.#i(),this.#r({scroll:!1,emit:!1}))})}disconnectedCallback(){super.disconnectedCallback(),this.#e=!1,this.#o&&(cancelAnimationFrame(this.#o),this.#o=0)}activeIndexChanged(){this.#e&&this.#r({scroll:!this.#t,emit:!0})}slidesPerViewChanged(){this.#e&&this.#r({scroll:!1,emit:!1})}handleSlidesSlotChange(){this.#i(),this.#r({scroll:!1,emit:!1})}handleViewportScroll(){this.#o||(this.#o=requestAnimationFrame(()=>{this.#o=0;let e=this.#n();e!==this.activeIndex&&(this.#t=!0,this.activeIndex=e,this.#t=!1)}))}handleViewportKeydown(e){if(e.defaultPrevented||this.slides.length<2)return!0;switch(fe(e.key,this)){case"ArrowRight":return e.preventDefault(),this.next(),!1;case"ArrowLeft":return e.preventDefault(),this.previous(),!1;case"Home":return e.preventDefault(),this.goTo(0),!1;case"End":return e.preventDefault(),this.goTo(this.#c),!1;default:return!0}}goTo(e){let i=this.#d(e);i!==this.activeIndex&&(this.activeIndex=i)}next(){if(!(this.slides.length<2)){if(this.loop){this.goTo((this.activeIndex+1)%(this.#c+1));return}this.goTo(this.activeIndex+1)}}previous(){if(!(this.slides.length<2)){if(this.loop){this.goTo((this.activeIndex-1+this.#c+1)%(this.#c+1));return}this.goTo(this.activeIndex-1)}}get canGoPrevious(){return this.slideCount>1&&(this.loop||this.activeIndex>0)}get canGoNext(){return this.slideCount>1&&(this.loop||this.activeIndex<this.#c)}get currentSlideStatus(){if(this.slideCount<1)return"";let e=this.#d(this.activeIndex),i=this.#l,o=Math.min(this.slideCount,e+i),r=this.slides[e];return i===1?`${r?.label??`Slide ${e+1}`} (${e+1} of ${this.slideCount})`:`Showing slides ${e+1} through ${o} of ${this.slideCount}`}#i(){let e=this.slideElements;e.forEach((i,o)=>{i.dataset.carouselIndex=String(o),i.dataset.carouselLabel=this.#a(i,o)}),this.slides=e.map((i,o)=>({index:o,label:i.dataset.carouselLabel??`Slide ${o+1}`})),this.slideCount=this.slides.length,this.#p(),this.#h()}#r(e){let i=this.#d(this.activeIndex);if(i!==this.activeIndex){this.activeIndex=i;return}let o=this.slideElements,r=o[i]??null;o.forEach((n,s)=>{let a=s>=i&&s<i+this.#l;n.toggleAttribute("data-active",a),n.toggleAttribute("inert",!a),n.setAttribute("aria-hidden",String(!a))}),this.#f(),this.#h(),e.scroll&&r&&this.#s(r),e.emit&&r&&(this.$emit("slide-change",{activeIndex:i,slide:r}),this.$emit("change"))}#s(e){let i=this.viewportElement;if(!i)return;let o=e.offsetLeft;if(typeof i.scrollTo=="function"){i.scrollTo({left:o,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});return}i.scrollLeft=o}#n(){let e=this.viewportElement,i=this.slideElements;if(!e||i.length<2)return 0;let o=e.scrollLeft,r=0,n=Number.POSITIVE_INFINITY;return i.forEach((s,a)=>{let l=Math.abs(s.offsetLeft-o);l<n&&(n=l,r=a)}),r}#a(e,i){return e.getAttribute("data-label")??e.getAttribute("aria-label")??e.getAttribute("title")??`Slide ${i+1}`}#d(e){return this.slideCount<1?0:Math.max(0,Math.min(e,this.#c))}get#l(){return this.slideCount<1?Math.max(1,this.slidesPerView||1):Math.max(1,Math.min(this.slidesPerView||1,this.slideCount))}get#c(){return Math.max(0,this.slideCount-this.#l)}get#u(){return Array.from({length:this.#c+1},(e,i)=>i)}#p(){let e=this.paginationElement;e&&(e.replaceChildren(),this.#u.forEach(i=>{let o=document.createElement("button");o.className="dot",o.part.add("dot"),o.type="button";let r=i+1,n=Math.min(this.slideCount,i+this.#l);o.setAttribute("aria-label",this.#l===1?`Go to ${this.slides[i]?.label??`slide ${r}`}`:`Go to slides ${r} through ${n}`),o.addEventListener("click",()=>{this.goTo(i)}),e.append(o)}),this.#f())}#f(){Array.from(this.shadowRoot?.querySelectorAll(".dot")??[]).forEach((i,o)=>{i.setAttribute("aria-pressed",String(this.#u[o]===this.activeIndex))})}#h(){this.style.setProperty("--_carousel-slides-per-view",String(this.#l));let e=this.#c>0,i=this.controlsElement;i&&(i.hidden=!e);let o=this.previousButtonElement;o&&(o.disabled=!this.canGoPrevious);let r=this.nextButtonElement;r&&(r.disabled=!this.canGoNext);let n=this.statusElement;n&&(n.hidden=!e,n.textContent=this.currentSlideStatus)}get viewportElement(){return this.shadowRoot?.querySelector(".viewport")??null}get paginationElement(){return this.shadowRoot?.querySelector(".pagination")??null}get controlsElement(){return this.shadowRoot?.querySelector(".controls")??null}get previousButtonElement(){return this.shadowRoot?.querySelector(".previous-button")}get nextButtonElement(){return this.shadowRoot?.querySelector(".next-button")}get statusElement(){return this.shadowRoot?.querySelector(".status")??null}get slideElements(){return(this.shadowRoot?.querySelector("slot")?.assignedElements({flatten:!0})??[]).filter(i=>i instanceof HTMLElement)}};Yv([f],wt.prototype,"slideCount",void 0);c(wt.prototype,"appearance");c(wt.prototype,"label");c({attribute:"active-index",converter:Vc})(wt.prototype,"activeIndex");c({attribute:"slides-per-view",converter:Vc})(wt.prototype,"slidesPerView");c({mode:"boolean"})(wt.prototype,"loop");var Oc={name:"violet-carousel",template:Qv,styles:Xv,shadowOptions:{delegatesFocus:!0}};function io(t){for(let e=t.parentElement;e;e=e.parentElement){if(!(e instanceof HTMLFieldSetElement)||!e.hasAttribute("disabled"))continue;if(!Array.from(e.children).find(o=>o instanceof HTMLLegendElement)?.contains(t))return!0}return!1}function G(t){let e=t,i=e.connectedCallback,o=e.disabledChanged;f(t,"fieldsetDisabled"),Object.defineProperty(t,"effectiveDisabled",{configurable:!0,get(){return!!this.disabled||!!this.fieldsetDisabled}}),Object.defineProperty(t,"formDisabledCallback",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=io(this)}}),Object.defineProperty(t,"fieldsetDisabledChanged",{configurable:!0,writable:!0,value(){o?.call(this)}}),Object.defineProperty(t,"disabledChanged",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=io(this),o?.call(this)}}),Object.defineProperty(t,"connectedCallback",{configurable:!0,writable:!0,value(){this.fieldsetDisabled=io(this),i?.call(this)}})}var Es=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Jv=b`
    ${V}

:host{
display:inline-grid;

--_selection-background:var(--violet-color-control-selected-background,#c0daeb);
--_selection-text:var(--violet-color-control-selected-foreground,#1b5f80);
--_selection-border:var(--violet-color-control-selected-border,rgba(27,95,128,0.5));
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_radius-sm:var(--violet-radius-inset,4px);
--_size-font-md:var(--violet-type-body-size,14px);
--_control-size:max(var(--_size-font-md),calc(var(--_target-size) * 0.5));
--_type-body-line:var(--violet-type-body-line,20px);
--_type-caption-line:var(--violet-type-caption-line,16px);
}

:host([inline]){
--_target-size:var(--violet-checkbox-inline-target-size,var(--_target-size-compact));
--_space-inline-sm:var(--violet-checkbox-inline-gap,4px);
}

.root{
display:inline-grid;
grid-template-columns:auto 1fr;
gap:var(--_space-inline-md);
align-items:start;
min-block-size:var(--_target-size);
}

:host([inline]) .root{
grid-template-columns:auto;
gap:0;
align-items:center;
min-block-size:auto;
}






.input{
position:absolute;
inset:0;
inline-size:100%;
block-size:100%;
margin:0;
padding:0;
appearance:none;
opacity:0;
border:0;
cursor:inherit;
}

.control-shell{
position:relative;
display:inline-grid;
min-block-size:var(--_target-size);
align-items:center;
cursor:pointer;
}

:host([inline]) .control-shell{
min-block-size:auto;
line-height:0;
}


.box{
box-sizing:border-box;
position:relative;
display:inline-grid;
pointer-events:none;
place-items:center;
inline-size:var(--_control-size);
block-size:var(--_control-size);
border:1px solid var(--_border-strong);
border-radius:var(--_radius-sm);
background:var(--_surface-card);
transition:
background-color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.checkmark,
.mixed-mark{
display:block;
grid-area:1 / 1;
justify-self:center;
align-self:center;
background:var(--_selection-text);
opacity:0;
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

.checkmark{
inline-size:calc(var(--_control-size) * 0.72);
block-size:calc(var(--_control-size) * 0.72);
clip-path:polygon(14% 44%,0 59%,37% 100%,100% 16%,84% 0,35% 62%);
transform:scale(0.7);
}

.mixed-mark{
inline-size:calc(var(--_control-size) * 0.56);
block-size:2px;
border-radius:999px;
transform:scaleX(0.7);
}

.input:checked + .box{
background:var(--_selection-background);
border-color:var(--_selection-border);
}

.input:checked + .box .checkmark{
opacity:1;
transform:scale(1);
}

.input:indeterminate + .box{
background:var(--_selection-background);
border-color:var(--_selection-border);
}

.input:indeterminate + .box .mixed-mark{
opacity:1;
transform:scaleX(1);
}

.root:hover .input:not(:checked):not(:indeterminate):not(:disabled) + .box{
border-color:var(--_field-border-hover);
}

.input:focus-visible + .box{
box-shadow:
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}


:host([invalid]) .box{
border-color:var(--_danger-border);
}

:host([disabled]) .control-shell,
:host(:disabled) .control-shell,
:host([disabled]) .label,
:host(:disabled) .label{
cursor:not-allowed;
}


:host([disabled]) :is(.control-shell,.label),
:host(:disabled) :is(.control-shell,.label){
opacity:0.5;
}





.content{
box-sizing:border-box;
display:grid;
gap:var(--_space-stack-2xs);
min-block-size:var(--_target-size);
padding-block:calc((var(--_target-size) - var(--_type-body-line)) / 2);
align-content:start;
}

.content[hidden]{
display:none;
}

:host([inline]) .content{
min-block-size:auto;
padding-block:0;
align-content:center;
}

.label{
color:var(--violet-color-text-primary,#181b1a);
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
overflow-wrap:break-word;
cursor:pointer;
}

.supporting{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
overflow-wrap:break-word;
}

.supporting[hidden]{
display:none;
}

.error{
color:var(--_danger-text);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
overflow-wrap:break-word;
}

@media (forced-colors:active){
.box,
.root:hover .input:not(:checked):not(:indeterminate):not(:disabled) + .box{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
box-shadow:none;
}

.checkmark,
.mixed-mark{
forced-color-adjust:none;
background:HighlightText;
}

.input:checked + .box,
.input:indeterminate + .box{
border-color:Highlight;
background:Highlight;
}

.input:focus-visible + .box{
outline:2px solid Highlight;
outline-offset:2px;
box-shadow:none;
}

:host([disabled]) .box,
:host(:disabled) .box{
border-color:GrayText;
}
}
`,Zv=h`
    <div class="root" part="root">
        <label class="control-shell">
            <input
                class="input"
                part="input"
                id="control"
                type="checkbox"
                :checked="${t=>t.checked}"
                name="${t=>t.name}"
                value="${t=>t.value}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-label="${t=>t.explicitAriaLabel}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @change="${(t,e)=>t.handleChange(e.event)}"
            />
            <span class="box" part="control" aria-hidden="true">
                <span class="checkmark" part="mark checkmark"></span>
                <span class="mixed-mark" part="mark mixed-mark"></span>
            </span>
        </label>
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting&&!t.displayErrorText}">
            <label class="label" part="label" for="control" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                part="supporting-text"
                id="supporting-text"
                ?hidden="${t=>!t.hasSupporting||!!t.displayErrorText}"
            >
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
            ${g(t=>!!t.displayErrorText,h`
                    <span class="error" part="error-message" id="error-message" role="alert">${t=>t.displayErrorText}</span>
                `)}
        </span>
    </div>
`,_e=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;get displayErrorText(){return this._displayErrorText}constructor(){super(),this.#t=new MutationObserver(()=>this.#l()),this.#o=()=>this.#c(),this._displayErrorText="",this.#e=this.attachInternals(),this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.indeterminate=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.errorText="",this.name="",this.value="on",this.required=!1,this.#i=!1,this.#r=!1}connectedCallback(){super.connectedCallback(),this.#i=this.hasAttribute("checked")?this.getAttribute("checked")!=="false":this.checked,this.#r=this.hasAttribute("indeterminate")?this.getAttribute("indeterminate")!=="false":this.indeterminate,this.#n(),this.#a(),this.#l(),this.#u(),this.#t.observe(this,{attributes:!0,attributeFilter:["aria-describedby","aria-label"]}),this.addEventListener("focusin",this.#o),M.enqueue(()=>this.#c())}disconnectedCallback(){super.disconnectedCallback(),this.#t.disconnect(),this.removeEventListener("focusin",this.#o)}handleChange(e){let i=e.currentTarget;this.checked=i?.checked??!1,this.indeterminate=!1,this.$emit("change",{checked:this.checked})}handleDefaultSlotChange(){this.#n()}handleSupportingSlotChange(){this.#a(),this.#c()}formStateRestoreCallback(e){(e==="checked"||e==="unchecked")&&(this.checked=e==="checked")}formResetCallback(){this.checked=this.#i,this.indeterminate=this.#r}get explicitAriaLabel(){return this.getAttribute("aria-label")?.trim()||null}get controlAriaLabel(){let e=this.explicitAriaLabel;return e||this.#d()||null}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}checkedChanged(){this.#l(),this.#u()}indeterminateChanged(){this.#l(),this.#u()}disabledChanged(){this.#l(),this.#u()}invalidChanged(){this.#l(),this.#u()}errorTextChanged(){this.#u()}#s(e){this._displayErrorText!==e&&(this._displayErrorText=e,this.$fastController.isConnected&&M.enqueue(()=>{M.enqueue(()=>{this.#c()})}))}requiredChanged(){this.#l(),this.#u()}valueChanged(){this.#l(),this.#u()}nameChanged(){this.#l()}#n(){this.hasLabel=this.#d().length>0}#a(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#d(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#l(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(!e)return;e.checked=this.checked,e.indeterminate=this.indeterminate,e.disabled=this.effectiveDisabled,e.required=this.required,e.name=this.name,e.value=this.value,e.setAttribute("aria-invalid",this.invalid?"true":"false");let i=this.explicitAriaLabel;i?e.setAttribute("aria-label",i):e.removeAttribute("aria-label"),this.#c()}#c(){let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(!e)return;let i=[],o=this.getRootNode();for(let l of(this.getAttribute("aria-describedby")??"").split(/\s+/).filter(Boolean)){let d=o.getElementById?.(l)??null;d&&!i.includes(d)&&i.push(d)}let r=this.displayErrorText?this.shadowRoot?.getElementById("error-message")??null:null,n=!r&&this.hasSupporting?this.shadowRoot?.getElementById("supporting-text")??null:null,s=r??n;if(s&&i.push(s),"ariaDescribedByElements"in e){e.removeAttribute("aria-describedby"),e.ariaDescribedByElements=i.length?i:null;return}s?e.setAttribute("aria-describedby",s.id):e.removeAttribute("aria-describedby")}#u(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(!this.effectiveDisabled&&this.checked?this.value:null,this.checked?"checked":"unchecked"),this.effectiveDisabled){this.#s(""),this.#e.setValidity({});return}if(this.invalid){let i=(this.errorText??"").trim();this.#s(i||e?.validationMessage||""),this.#e.setValidity({customError:!0},i||"Please correct this field.",e??void 0);return}if(this.#s(""),this.required&&!this.checked){this.#e.setValidity({valueMissing:!0},"Please select this option.",e??void 0);return}this.#e.setValidity({})}};Es([f],_e.prototype,"hasSupporting",void 0);Es([f],_e.prototype,"hasLabel",void 0);Es([f],_e.prototype,"_displayErrorText",void 0);c({mode:"boolean"})(_e.prototype,"checked");c({mode:"boolean"})(_e.prototype,"indeterminate");c({mode:"boolean"})(_e.prototype,"disabled");G(_e.prototype);c({mode:"boolean"})(_e.prototype,"inline");c({mode:"boolean"})(_e.prototype,"invalid");c({attribute:"error-text"})(_e.prototype,"errorText");c(_e.prototype,"name");c(_e.prototype,"value");c({mode:"boolean"})(_e.prototype,"required");var Lc={name:"violet-checkbox",template:Zv,styles:Jv,shadowOptions:{delegatesFocus:!0}};var eg=/^#?([\da-f]{3}|[\da-f]{6})$/i;function _t(t,e,i){return Math.min(i,Math.max(e,t))}function kt(t){let e=t.trim(),i=eg.exec(e);if(!i)return null;let o=i[1].toLowerCase();return o.length===3?`#${o.split("").map(r=>`${r}${r}`).join("")}`:`#${o}`}function tg(t){return`#${[t.r,t.g,t.b].map(e=>_t(Math.round(e),0,255).toString(16).padStart(2,"0")).join("")}`}function ig(t){let e=kt(t);return e?{r:Number.parseInt(e.slice(1,3),16),g:Number.parseInt(e.slice(3,5),16),b:Number.parseInt(e.slice(5,7),16)}:null}function og(t){let e=_t(t.r,0,255)/255,i=_t(t.g,0,255)/255,o=_t(t.b,0,255)/255,r=Math.max(e,i,o),n=Math.min(e,i,o),s=r-n,a=0,l=(r+n)/2;if(s>0)switch(r){case e:a=((i-o)/s+(i<o?6:0))*60;break;case i:a=((o-e)/s+2)*60;break;default:a=((e-i)/s+4)*60;break}let d=s===0?0:s/(1-Math.abs(2*l-1));return{h:Math.round((a%360+360)%360),s:Math.round(d*100),l:Math.round(l*100)}}function Ts(t,e,i){let o=i;return o<0&&(o+=1),o>1&&(o-=1),o<1/6?t+(e-t)*6*o:o<1/2?e:o<2/3?t+(e-t)*(2/3-o)*6:t}function rg(t){let e=(t.h%360+360)%360/360,i=_t(t.s,0,100)/100,o=_t(t.l,0,100)/100;if(i===0){let s=Math.round(o*255);return{r:s,g:s,b:s}}let r=o<.5?o*(1+i):o+i-o*i,n=2*o-r;return{r:Math.round(Ts(n,r,e+1/3)*255),g:Math.round(Ts(n,r,e)*255),b:Math.round(Ts(n,r,e-1/3)*255)}}function Pc(t){let e=ig(t);return e?og(e):null}function li(t){return tg(rg(t))}function Bc(t,e){return`linear-gradient(90deg, ${li({h:t,s:0,l:e})} 0%, ${li({h:t,s:100,l:e})} 100%)`}function Nc(t,e){return`linear-gradient(90deg, ${li({h:t,s:e,l:0})} 0%, ${li({h:t,s:e,l:50})} 50%, ${li({h:t,s:e,l:100})} 100%)`}function Q(t){if(!t.invalid||t.disabled||t.readonly)return"";let e=(t.errorText??"").trim();return e||(t.fallbackValidationMessage??"").trim()}var ng="#146ba0",sg=["#181b1a","#2c5e4b","#a3ebcd","#146ba0","#c42a1a","#f96e5b","#92400e","#6b7d6e"],Hc=0,ag=b`
    ${V}

:host{
position:relative;
display:grid;
}

:host([size="compact"]){
--violet-target-size:var(--_target-size-compact);
--violet-control-label-size:var(--_type-label-size-compact);
--violet-control-body-size:var(--_type-body-size-compact);
--violet-control-caption-size:var(--_type-caption-size-compact);
}

:host([size="natural"]){
--violet-target-size:var(--_target-size-natural);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

:host([size="comfortable"]){
--violet-target-size:var(--_target-size-comfortable);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-shell{
position:relative;
display:grid;
}

.control-shell.open{
z-index:var(--_layer-raised);
}

.trigger{
box-sizing:border-box;
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-inline-md);
inline-size:100%;
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
padding-block:calc(var(--_space-stack-xs) + 2px);
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
cursor:pointer;
text-align:start;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.trigger:hover{
box-shadow:var(--_field-shadow-hover);
}

.trigger:focus-visible,
.control-shell.open .trigger{
outline:none;
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .trigger,
:host(:disabled) .trigger{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .trigger,
:host([data-invalid]) .trigger{
border-color:var(--_danger-border);
}

.swatch{
flex:0 0 auto;
}

.trigger-copy{
display:grid;
gap:1px;
min-inline-size:0;
}

.trigger-value{
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
color:var(--violet-color-text-primary,#181b1a);
}

.trigger-value.placeholder{
color:var(--_text-muted);
}

.trigger-meta{
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
color:var(--_text-muted);
}

.trigger-icon{
display:inline-grid;
place-items:center;
color:var(--_text-muted);
transition:transform var(--_duration-base) var(--_easing-standard);
}

.control-shell.open .trigger-icon{
transform:rotate(90deg);
}

.trigger-icon violet-icon{
--violet-icon-size:1rem;
}

.panel{
box-sizing:border-box;
position:fixed;
inset:unset;
inline-size:min(26rem,calc(100vw - 8px));
max-inline-size:calc(100vw - 16px);
padding:var(--_space-stack-sm);
border:1px solid var(--_border-subtle);
border-radius:calc(var(--_radius-md) * 2);
background:var(--_surface-card);
box-shadow:var(--_shadow-floating);
color:inherit;
z-index:var(--_layer-popover);
gap:var(--_space-stack-sm);
opacity:0;
transform:translateY(calc(var(--_space-stack-xs) * -1));
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard),
display var(--_duration-fast) var(--_easing-standard) allow-discrete,
overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
}







.panel:popover-open,
.panel.open{
display:grid;
opacity:1;
transform:translateY(0);

@starting-style{
opacity:0;
transform:translateY(calc(var(--_space-stack-xs) * -1));
}
}

.panel::backdrop{
background:transparent;
}

.panel-header{
display:flex;
align-items:center;
gap:var(--_space-inline-md);
}

.preview-copy{
display:grid;
gap:0;
min-inline-size:0;
}

.panel-title{
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
font-weight:600;
color:var(--violet-color-text-primary,#181b1a);
}

.hex-field{
display:grid;
gap:var(--_space-stack-2xs);
}

.field-label{
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
color:var(--_text-secondary);
}

.hex-input{
box-sizing:border-box;
inline-size:100%;
min-block-size:calc(var(--_target-size) - 4px);
padding-inline:max(var(--_space-inline-md),0.75rem);
border:1px solid var(--_field-border);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
font:inherit;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
box-shadow:var(--_shadow-control);
}

.hex-input:hover{
border-color:var(--_field-border-hover);
}

.hex-input:focus{
outline:none;
}

.hex-input:focus-visible{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

.hex-hint{
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
color:var(--_text-muted);
}

.channels{
display:grid;
gap:var(--_space-stack-sm);
}

.channel{
display:grid;
gap:var(--_space-stack-2xs);
}

.channel-header{
display:flex;
align-items:baseline;
justify-content:space-between;
gap:var(--_space-inline-md);
}

.channel-value{
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
color:var(--_text-muted);
}

.channel-input{
appearance:none;
-webkit-appearance:none;
inline-size:100%;
block-size:1.125rem;
margin:0;
border:0;
background:transparent;
}

.channel-input:focus{
outline:none;
}

.channel-input::-webkit-slider-runnable-track{
block-size:0.625rem;
border-radius:var(--_radius-round,9999px);
background:var(--_channel-track,var(--_surface-subtle));
}

.channel-input::-moz-range-track{
block-size:0.625rem;
border-radius:var(--_radius-round,9999px);
background:var(--_channel-track,var(--_surface-subtle));
}

.channel-input::-webkit-slider-thumb{
appearance:none;
-webkit-appearance:none;
inline-size:1rem;
block-size:1rem;
margin-block-start:-0.1875rem;
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-round,9999px);
background:var(--_surface-page);
box-shadow:var(--_shadow-control);
}

.channel-input::-moz-range-thumb{
inline-size:1rem;
block-size:1rem;
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-round,9999px);
background:var(--_surface-page);
box-shadow:var(--_shadow-control);
}

.channel-input:focus-visible::-webkit-slider-thumb{
box-shadow:
var(--_shadow-control),
0 0 0 2px var(--_focus-ring);
}

.channel-input:focus-visible::-moz-range-thumb{
box-shadow:
var(--_shadow-control),
0 0 0 2px var(--_focus-ring);
}

.presets{
display:grid;
gap:var(--_space-stack-2xs);
}

.preset-grid{
display:flex;
flex-wrap:wrap;
gap:var(--_space-inline-md);
}

.preset-button{
display:inline-grid;
place-items:center;
padding:0;
border:1px solid transparent;
background:transparent;
cursor:pointer;
border-radius:var(--_radius-round,9999px);
}

.preset-button[aria-pressed="true"]{
border-color:color-mix(in srgb,var(--_focus-ring) 48%,var(--_border-subtle));
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 25%,transparent);
}

.preset-button:focus-visible{
outline:none;
border-color:color-mix(in srgb,var(--_focus-ring) 48%,var(--_border-subtle));
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 25%,transparent);
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

.control-shell.open ~ .supporting,
.control-shell.open ~ .error{
visibility:hidden;
}
`,lg=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`<label class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</label>`)}
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
                        ${N(t=>t.presets,h`
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
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${g(t=>!!t.displayErrorText,h`<p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>`)}
    </div>
`,le=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;constructor(){super(),this.#t="",this.#o="",this.#i=!1,this.#r=()=>{this.open&&this.positionPanel()},this.open=!1,this.hue=0,this.saturation=0,this.lightness=0,this.hexDraft="",this.validationInvalid=!1;let e=Hc;Hc+=1,this.#e=this.attachInternals(),this.labelId=`violet-color-picker-label-${e}`,this.triggerId=`violet-color-picker-trigger-${e}`,this.valueId=`violet-color-picker-value-${e}`,this.metaId=`violet-color-picker-meta-${e}`,this.panelId=`violet-color-picker-panel-${e}`,this.supportingId=`violet-color-picker-supporting-${e}`,this.errorId=`violet-color-picker-error-${e}`,this.hexInputId=`violet-color-picker-hex-${e}`,this.hexHintId=`violet-color-picker-hex-hint-${e}`,this.hueInputId=`violet-color-picker-hue-${e}`,this.saturationInputId=`violet-color-picker-saturation-${e}`,this.lightnessInputId=`violet-color-picker-lightness-${e}`,this.label="",this.value="",this.name="",this.supportingText="",this.errorText="",this.disabled=!1,this.required=!1,this.invalid=!1,this.size="natural",this.syncFromColor(this.value)}connectedCallback(){super.connectedCallback(),this.#o=this.value,this.#t=this.currentSelectedColor,this.syncFromColor(this.value),this.#s(),this.syncOpenState(),window.addEventListener("resize",this.#r),window.addEventListener("scroll",this.#r,!0)}disconnectedCallback(){window.removeEventListener("resize",this.#r),window.removeEventListener("scroll",this.#r,!0),super.disconnectedCallback()}valueChanged(){this.$fastController.isConnected&&(this.#i||(this.#t=this.currentSelectedColor),this.syncFromColor(this.value),this.#s())}disabledChanged(){this.effectiveDisabled&&this.open&&this.close(),this.$fastController.isConnected&&this.#s()}requiredChanged(){this.$fastController.isConnected&&this.#s()}invalidChanged(){this.$fastController.isConnected&&this.#s()}errorTextChanged(){this.$fastController.isConnected&&this.#s()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get presets(){return sg}get currentDisplayColor(){return kt(this.value)??li({h:this.hue,s:this.saturation,l:this.lightness})}get currentSelectedColor(){return kt(this.value)??""}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText})}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get labelledBy(){let e=[];return this.label&&e.push(this.labelId),e.push(this.valueId,this.metaId),e.join(" ")}get panelLabel(){return this.label?`${this.label} color picker`:"Color picker"}get panelTitleText(){return this.value?"Selected color":"No color selected"}get controlShellClass(){return`control-shell${this.open?" open":""}`}get panelClass(){return`panel${this.open?" open":""}`}get expandedText(){return String(this.open)}get ariaInvalidText(){return this.invalid&&!this.effectiveDisabled?"true":"false"}get isInvalid(){return!this.effectiveDisabled&&this.invalid}get swatchSize(){return this.size}get triggerValueClass(){return this.value?"trigger-value":"trigger-value placeholder"}get triggerValueText(){return this.value||"Choose color"}get triggerMetaText(){return this.value?"Adjust color":"Select a color"}get saturationTrackStyle(){return`--_channel-track: ${Bc(this.hue,this.lightness)};`}get lightnessTrackStyle(){return`--_channel-track: ${Nc(this.hue,this.saturation)};`}toggleOpen(){if(this.effectiveDisabled)return;let e=this.panelElement;e&&(e.matches(":popover-open")?e.hidePopover():e.showPopover())}close(){this.panelElement?.matches(":popover-open")&&this.panelElement.hidePopover()}handleToggle(e){this.open=e.newState==="open",this.syncOpenState(),this.open?(this.positionPanel(),requestAnimationFrame(()=>{this.positionPanel(),this.hexInputElement?.focus(),this.hexInputElement?.select()})):(this.hexDraft=this.currentSelectedColor,this.syncHexInputValue())}handleHexInput(e){e.stopPropagation();let i=e.currentTarget;this.hexDraft=i.value;let o=kt(i.value);!o||i.value.trim().replace(/^#/,"").length!==6||this.applyColor(o,!0,!1)}handleInput(e){this.handleHexInput(e)}handleHexCommit(e){let i=e.currentTarget,o=kt(i.value);if(!o){this.hexDraft=this.currentSelectedColor,this.syncHexInputValue();return}this.applyColor(o,!0,!0)}handleCommit(e){this.handleHexCommit(e)}handleChannelInput(e,i){i.stopPropagation();let o=i.currentTarget,r=Number(o.value);this.updateChannel(e,r),this.commitFromChannels(!0,!1)}handleChannelCommit(e,i){let o=i.currentTarget,r=Number(o.value);this.updateChannel(e,r),this.commitFromChannels(!0,!0)}handleHueInput(e){this.handleChannelInput("h",e)}handleHueCommit(e){this.handleChannelCommit("h",e)}handleSaturationInput(e){this.handleChannelInput("s",e)}handleSaturationCommit(e){this.handleChannelCommit("s",e)}handleLightnessInput(e){this.handleChannelInput("l",e)}handleLightnessCommit(e){this.handleChannelCommit("l",e)}applyPreset(e){this.applyColor(e,!0,!0)}presetAriaLabel(e){return`Use ${e}`}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#o,this.syncFromColor(this.value),this.#s()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get panelElement(){return this.shadowRoot?.querySelector(".panel")??null}get controlShellElement(){return this.shadowRoot?.querySelector(".control-shell")??null}get hexInputElement(){return this.shadowRoot?.querySelector(".hex-input")??null}syncFromColor(e){let i=kt(e),o=Pc(i||ng);o&&(this.hue=o.h,this.saturation=o.s,this.lightness=o.l,this.hexDraft=i??"",this.syncHexInputValue())}updateChannel(e,i){switch(e){case"h":this.hue=_t(i,0,360);break;case"s":this.saturation=_t(i,0,100);break;case"l":this.lightness=_t(i,0,100);break}}commitFromChannels(e,i){let o=li({h:this.hue,s:this.saturation,l:this.lightness});this.applyColor(o,e,i)}applyColor(e,i,o){let r=kt(e);if(!r)return;let n=r!==this.currentSelectedColor;n&&(this.#i=!0,this.value=r,this.#i=!1),this.hexDraft=r,this.syncFromColor(r),this.#s(),i&&n&&this.$emit("input",{value:r}),o&&r!==this.#t&&(this.#t=r,this.$emit("change",{value:r}))}#s(){if(this.#e.setFormValue(this.value||null),this.effectiveDisabled){this.validationInvalid=!1,this.removeAttribute("data-invalid"),this.#e.setValidity({});return}if(this.invalid){this.validationInvalid=!0,this.setAttribute("data-invalid",""),this.#e.setValidity({customError:!0},(this.errorText??"").trim()||"The selected color is invalid.");return}if(this.validationInvalid=!1,this.removeAttribute("data-invalid"),this.required&&!this.value){this.#e.setValidity({valueMissing:!0},(this.errorText??"").trim()||"Select a color.");return}this.#e.setValidity({})}syncHexInputValue(){let e=this.hexInputElement;!e||e.value===this.hexDraft||(e.value=this.hexDraft)}syncOpenState(){this.controlShellElement?.classList.toggle("open",this.open),this.panelElement?.classList.toggle("open",this.open),this.panelElement&&(this.panelElement.style.opacity=this.open?"1":"0",this.panelElement.style.transform=this.open?"translateY(0)":"translateY(calc(var(--_space-stack-xs) * -1))")}positionPanel(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".trigger");if(!e||!i)return;let o=i.getBoundingClientRect(),r=8,n=6,s=o.left,a=o.bottom+n,l=Math.min(Math.max(o.width,320),window.innerWidth-r*2);e.style.width=`${l}px`,e.style.left=`${Math.max(r,s)}px`,e.style.top=`${Math.max(r,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-r&&(s=Math.max(r,window.innerWidth-d.width-r)),d.bottom>window.innerHeight-r&&(a=Math.max(r,o.top-d.height-n)),e.style.left=`${s}px`,e.style.top=`${a}px`})}};c(le.prototype,"label");c(le.prototype,"value");c(le.prototype,"name");c({attribute:"supporting-text"})(le.prototype,"supportingText");c({attribute:"error-text"})(le.prototype,"errorText");c({mode:"boolean"})(le.prototype,"disabled");G(le.prototype);c({mode:"boolean"})(le.prototype,"required");c({mode:"boolean"})(le.prototype,"invalid");c(le.prototype,"size");f(le.prototype,"open");f(le.prototype,"hue");f(le.prototype,"saturation");f(le.prototype,"lightness");f(le.prototype,"hexDraft");f(le.prototype,"validationInvalid");var jc={name:"violet-color-picker",template:lg,styles:ag,shadowOptions:{delegatesFocus:!0}};var cg=b`
    ${A}

:host{
display:inline-grid;
color:inherit;
}

:host([size="compact"]){
--_swatch-size:1rem;
}

:host([size="natural"]){
--_swatch-size:1.25rem;
}

:host([size="comfortable"]){
--_swatch-size:1.5rem;
}

.swatch{
position:relative;
inline-size:var(--_swatch-size,1.25rem);
block-size:var(--_swatch-size,1.25rem);
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
box-shadow:inset 0 0 0 1px color-mix(in srgb,white 24%,transparent);
overflow:hidden;
background:
linear-gradient(45deg,color-mix(in srgb,var(--_text-primary) 6%,transparent) 25%,transparent 25%,transparent 75%,color-mix(in srgb,var(--_text-primary) 6%,transparent) 75%),
linear-gradient(45deg,color-mix(in srgb,var(--_text-primary) 6%,transparent) 25%,transparent 25%,transparent 75%,color-mix(in srgb,var(--_text-primary) 6%,transparent) 75%),
var(--_swatch-color,transparent);
background-position:
0 0,
0.375rem 0.375rem,
0 0;
background-size:
0.75rem 0.75rem,
0.75rem 0.75rem,
auto;
}

:host([shape="circle"]) .swatch{
border-radius:var(--_radius-round);
}
`,dg=h`
    <span
        class="swatch"
        part="swatch"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-label="${t=>t.decorative?null:t.ariaLabel}"
        style="${t=>`--_swatch-color: ${t.normalizedValue||"transparent"};`}"
    ></span>
`,jt=class extends y{constructor(){super(),this.value="",this.label="",this.decorative=!1,this.shape="square",this.size="natural"}get normalizedValue(){return kt(this.value)??""}get ariaLabel(){return this.label||this.normalizedValue||"No color selected"}};c(jt.prototype,"value");c(jt.prototype,"label");c({mode:"boolean"})(jt.prototype,"decorative");c(jt.prototype,"shape");c(jt.prototype,"size");var qc={name:"violet-color-swatch",template:dg,styles:cg};var Wc=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},ug=b`
    ${A}

:host{
display:block;
--_approval-font-size:var(--violet-approval-font-size,var(--_body-size));
--_approval-line-height:var(--violet-approval-line-height,var(--_body-line));
--_approval-caption-size:var(--violet-approval-caption-size,var(--_caption-size));
--_warning-bg-subtle:var(--violet-color-state-warning-background,#f3e8d2);
--_warning-text:var(--violet-color-state-warning-text,#92400e);
--_success-bg-subtle:var(--violet-color-state-success-background,#dfeae3);
--_success-text:var(--violet-color-state-success-text,#2c5e4b);
--_danger-bg-subtle:var(--violet-color-state-danger-background,#f7e4df);
--_danger-text:var(--violet-color-state-danger-text,#c42a1a);
}


.frame{
display:block;
--violet-card-border-color:transparent;
--violet-card-background:var(--_surface-card);
--violet-card-shadow:var(--_shadow-card);
}

.frame::part(root){
overflow:hidden;
}


.frame::part(header){
padding:0;
}

.frame::part(body){
border-block-start-color:transparent;
}


:host(:not([state="pending"])) .frame::part(footer){
display:none;
}

.header{
display:flex;
align-items:center;
justify-content:space-between;
gap:var(--_space-sm);
padding:var(--_space-sm) var(--_space-md);
background:var(--_warning-bg-subtle);
font-size:var(--violet-type-label-size,13px);
line-height:var(--_approval-line-height);
font-weight:500;
color:var(--_warning-text);
}

:host([state="approved"]) .header{
background:var(--_success-bg-subtle);
color:var(--_success-text);
}

:host([state="denied"]) .header{
background:var(--_danger-bg-subtle);
color:var(--_danger-text);
}

.header-leading{
display:flex;
align-items:center;
gap:var(--_space-sm);
min-inline-size:0;
}

.header-icon{
flex-shrink:0;
display:inline-flex;
align-items:center;
justify-content:center;
--violet-icon-size:1rem;
}

.header-title{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.status-chip{
flex-shrink:0;
margin-inline-start:auto;
padding:var(--_space-stack-2xs) var(--_space-sm);

border:1px solid transparent;
border-radius:calc(var(--_radius-md) - 2px);
background:color-mix(in srgb,currentColor 12%,transparent);
font-size:var(--_approval-caption-size);
font-weight:500;
line-height:var(--_caption-line);
color:inherit;
}



:host([state="denied"]) .status-chip{
background:transparent;
border-color:color-mix(in srgb,currentColor 40%,transparent);
}

.summary{
display:grid;
gap:var(--_space-stack-2xs);
font-size:var(--_approval-font-size);
line-height:var(--_approval-line-height);
color:var(--_text-primary);
}

.detail{
display:grid;
gap:var(--_space-stack-2xs);
margin-block-start:var(--_space-stack-xs);
font-size:var(--_approval-caption-size);
line-height:var(--_caption-line);
color:var(--_text-muted);
}

slot[name="summary"]::slotted(*),
slot[name="detail"]::slotted(*){
margin:0;
}

.detail[hidden]{
display:none;
}

.actions{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:0;
}

.actions[hidden]{
display:none;
}

@media (forced-colors:active){




.frame > *{
forced-color-adjust:none;
}


slot{
forced-color-adjust:auto;
color:CanvasText;
}

.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
}

.status-chip{
border-color:currentColor;
}

.frame::part(body){
border-block-start-color:ButtonText;
}


.header,
:host([state]) .header,
.summary,
.detail{
background:Canvas;
color:CanvasText;
}

violet-button,
violet-icon,
::slotted(violet-button),
::slotted(violet-icon){
forced-color-adjust:auto;
}
}
`,hg=h`
    <violet-card class="frame" part="root" appearance="outline" padding="medium" aria-label="Action requires approval">
        <div class="header" part="header" slot="header">
            <span class="header-leading">
                <span class="header-icon">
                    ${t=>t.state==="approved"?h`<violet-icon icon="system/checkmark" decorative></violet-icon>`:t.state==="denied"?h`<violet-icon icon="system/dismiss" decorative></violet-icon>`:h`<violet-icon icon="system/warning" decorative></violet-icon>`}
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
`,Si=class extends y{constructor(){super(),this.state="pending",this.hasSummary=!1,this.hasDetail=!1}connectedCallback(){super.connectedCallback(),ti(),We(),Ki(),this.handleSummarySlotChange(),this.handleDetailSlotChange()}handleApprove(){this.$emit("approve")}handleDeny(){this.$emit("deny")}handleSummarySlotChange(){let e=this.shadowRoot?.querySelector('slot[name="summary"]');this.hasSummary=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleDetailSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="detail"]');this.hasDetail=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};Wc([f],Si.prototype,"hasSummary",void 0);Wc([f],Si.prototype,"hasDetail",void 0);c(Si.prototype,"state");var Kc={name:"violet-approval-card",template:hg,styles:ug};var $s=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},pg=b`
    ${A}

:host{
display:block;
--_composer-font-size:var(--violet-composer-font-size,var(--_body-size));
--_composer-line-height:var(--violet-composer-line-height,var(--_body-line));
--_composer-min-rows:var(--violet-composer-min-rows,3);
--_composer-max-rows:var(--violet-composer-max-rows,8);
}

.root{
display:flex;
flex-direction:column;

border:var(--_card-border-width,1px) solid transparent;
border-radius:var(--_radius-lg);
background:var(--_surface-card);
box-shadow:var(--_shadow-card);
overflow:hidden;
transition:box-shadow 0.15s ease;
}

.root:focus-within{
box-shadow:
var(--_shadow-card),
0 0 0 2px var(--_focus-ring);
}

.input-row{
display:flex;
align-items:flex-end;
gap:var(--_space-sm);
padding:var(--_space-sm) var(--_space-md);
}

.input-field{
flex:1;
min-inline-size:0;
--_surface-page:transparent;
--_surface-subtle:transparent;
--_border-subtle:transparent;
--_shadow-control:none;
--_focus-ring:transparent;
}

.input-field::part(control-frame){
min-block-size:auto;
padding:0;
border:0;
background:transparent;
box-shadow:none;
}

.input-field::part(label){
position:absolute;
inline-size:1px;
block-size:1px;
padding:0;
margin:-1px;
overflow:hidden;
clip:rect(0 0 0 0);
clip-path:inset(50%);
white-space:nowrap;
border:0;
}

.input-field::part(control){
min-block-size:calc(var(--_composer-line-height) * var(--_composer-min-rows));
max-block-size:calc(var(--_composer-line-height) * var(--_composer-max-rows));
padding-block:var(--_space-stack-xs);
resize:none;
overflow-y:auto;
field-sizing:content;
}

.actions{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:0 var(--_space-md) var(--_space-sm);
}

.actions[hidden]{
display:none;
}

.footer{
padding:var(--_space-stack-xs) var(--_space-md);
border-block-start:var(--_card-border-width,1px) solid transparent;
font-size:var(--_caption-size);
color:var(--_text-muted);
}

.footer[hidden]{
display:none;
}

@media (forced-colors:active){
.root{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
box-shadow:none;
}

.root:focus-within{
box-shadow:0 0 0 2px Highlight;
}
}
`,fg=h`
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
            ${t=>t.status==="streaming"?h`
                    <violet-icon-button
                        appearance="primary"
                        label="Stop generating"
                        part="stop-button"
                        @click="${e=>e.handleStop()}"
                    >
                        <violet-icon icon="system/stop" decorative></violet-icon>
                    </violet-icon-button>
                `:h`
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
`,Ge=class extends y{constructor(){super(),this.status="ready",this.placeholder="Send a message\u2026",this.label="Message",this.disabled=!1,this.value="",this.hasInput=!1,this.hasActions=!1,this.hasFooter=!1}connectedCallback(){super.connectedCallback(),gl(),kl(),this.syncInputState(),queueMicrotask(()=>this.syncTextareaHeight())}get textAreaField(){return this.shadowRoot?.querySelector("violet-text-area")}get textareaEl(){return this.textAreaField?.shadowRoot?.querySelector("textarea")}get canSubmit(){return!this.disabled&&this.status!=="submitted"&&this.status!=="streaming"&&!!this.value.trim()}handleKeydown(e){return e.isComposing||e.keyCode===229?!0:e.key==="Enter"&&!e.shiftKey?(e.preventDefault(),this.status!=="streaming"&&this.handleSubmit(),!1):!0}handleInput(e){let i=this.textAreaField;this.value=i?.value??"",this.hasInput=!!this.value.trim(),this.syncTextareaHeight()}handleSubmit(){let e=this.textAreaField,i=e?.value.trim();!i||this.disabled||this.status==="submitted"||this.status==="streaming"||(this.$emit("submit",{text:i}),e&&(e.value=""),this.value="",this.hasInput=!1,this.syncTextareaHeight())}handleStop(){this.$emit("stop")}handleActionsSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="actions"]');this.hasActions=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}valueChanged(){this.$fastController.isConnected&&(this.syncInputState(),queueMicrotask(()=>this.syncTextareaHeight()))}syncInputState(){this.hasInput=!!this.value.trim()}syncTextareaHeight(){let e=this.textareaEl;if(!e)return;let i=Number.parseFloat(getComputedStyle(e).lineHeight)||20,o=Number.parseFloat(getComputedStyle(this).getPropertyValue("--_composer-max-rows"))||8,r=i*o;e.style.height="auto",e.style.height=`${Math.min(e.scrollHeight,r)}px`,e.style.overflowY=e.scrollHeight>r?"auto":"hidden"}};$s([f],Ge.prototype,"hasInput",void 0);$s([f],Ge.prototype,"hasActions",void 0);$s([f],Ge.prototype,"hasFooter",void 0);c(Ge.prototype,"status");c(Ge.prototype,"placeholder");c(Ge.prototype,"label");c({mode:"fromView"})(Ge.prototype,"value");c({mode:"boolean"})(Ge.prototype,"disabled");var Uc={name:"violet-chat-composer",template:fg,styles:pg,shadowOptions:{delegatesFocus:!0}};var mg=b`
    ${A}

:host{
display:block;
--_suggestion-font-size:var(--violet-suggestion-font-size,var(--_body-size));
--_suggestion-line-height:var(--violet-suggestion-line-height,var(--_body-line));
}

.root{
display:flex;
flex-wrap:wrap;
gap:var(--_space-sm);
}

:host([orientation="vertical"]) .root{
flex-direction:column;
flex-wrap:nowrap;
}


::slotted(*){
all:unset;
box-sizing:border-box;
display:inline-flex;
align-items:center;
min-block-size:var(--violet-size-target-natural,32px);
padding:0 var(--_space-md);
border:var(--_card-border-width,1px) solid var(--violet-color-action-secondary-border,transparent);
border-radius:var(--_radius-round);
background:var(--violet-color-action-secondary-background,var(--_surface-subtle));
font-size:var(--_suggestion-font-size);
line-height:var(--_suggestion-line-height);
color:var(--_text-primary);
cursor:pointer;
transition:background 0.15s ease,border-color 0.15s ease;
white-space:nowrap;
}

::slotted(*:hover){
background:var(--_surface-hover);
}

::slotted(*:focus-visible){
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}

@media (forced-colors:active){
::slotted(*){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
}

::slotted(*:hover){
background:Highlight;
color:HighlightText;
}
}
`,vg=h`
    <div class="root" part="root" role="group" aria-label="Suggested prompts">
        <slot @slotchange="${t=>t.ensureChipRoles()}" @click="${(t,e)=>t.handleClick(e.event)}" @keydown="${(t,e)=>t.handleKeydown(e.event)}"></slot>
    </div>
`,Qo=class extends y{constructor(){super(),this.orientation="horizontal"}connectedCallback(){super.connectedCallback(),this.ensureChipRoles()}chipOf(e){let i=e;for(;i&&i.parentNode!==this;)i=i.parentNode;return i instanceof HTMLElement?i:null}handleClick(e){let i=this.chipOf(e.target);if(i){let o=i.textContent?.trim()??"";o&&this.$emit("select",{text:o})}}handleKeydown(e){let i=this.chipOf(e.target)??e.target;if((e.key==="Enter"||e.key===" ")&&this.chipOf(e.target)){e.preventDefault();let o=i.textContent?.trim()??"";return o&&this.$emit("select",{text:o}),!1}return e.key==="ArrowRight"||e.key==="ArrowDown"?(e.preventDefault(),this.focusNextChip(i,1),!1):e.key==="ArrowLeft"||e.key==="ArrowUp"?(e.preventDefault(),this.focusNextChip(i,-1),!1):!0}ensureChipRoles(){for(let e of Array.from(this.children))e.getAttribute("role")||e.setAttribute("role","button"),e.hasAttribute("tabindex")||e.setAttribute("tabindex","0")}focusNextChip(e,i){let o=Array.from(this.children),r=o.indexOf(e);if(r===-1)return;let n=o[r+i];n&&n.focus()}};c(Qo.prototype,"orientation");var Gc={name:"violet-chat-suggestions",template:vg,styles:mg};var Yc=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},gg=b`
    ${A}

:host{
display:flex;
flex-direction:column;
min-block-size:0;
position:relative;
overflow:hidden;
}

.scroll-region{
flex:1;
overflow-y:auto;
overflow-x:hidden;
scroll-behavior:smooth;
overscroll-behavior-y:contain;
}

.scroll-region:focus-visible{
outline:none;
box-shadow:inset 0 0 0 2px var(--_focus-ring);
}

.content{
display:flex;
flex-direction:column;
gap:var(--_space-md);
padding:var(--_space-sm);
}

.empty{
display:flex;
flex-direction:column;
align-items:center;
justify-content:center;
flex:1;
padding:var(--_space-lg);
color:var(--_text-secondary);
text-align:center;
}

.empty[hidden]{
display:none;
}

.scroll-anchor{
block-size:0;
overflow:hidden;
}
`,bg=h`
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
`,ci=class extends y{constructor(){super(),this.busy=!1,this.empty=!1,this.isOverflowing=!1,this.userScrolledAway=!1}get#e(){return this.shadowRoot?.querySelector(".scroll-region")??null}connectedCallback(){super.connectedCallback(),this.#r(),this.#s(),this.#n()}scrollToBottom(){let e=this.#e;e&&(e.scrollTop=e.scrollHeight,this.userScrolledAway=!1,this.#t=e.scrollHeight-e.scrollTop-e.clientHeight>1)}cancelAutoScroll(){return this.#t=!1,!0}#t=!1;handleScroll(e){let i=this.#e;if(!i)return;let o=i.scrollHeight-i.scrollTop-i.clientHeight;if(this.#t){o<=1&&(this.#t=!1);return}this.userScrolledAway=o>50}#o=null;#i=null;#r(){this.#o=new MutationObserver(()=>{this.#n(),this.userScrolledAway||requestAnimationFrame(()=>this.scrollToBottom())});let e=this.shadowRoot?.querySelector("slot:not([name])");e&&e.addEventListener("slotchange",()=>{this.#n(),this.userScrolledAway||requestAnimationFrame(()=>this.scrollToBottom())}),this.#o.observe(this,{childList:!0,subtree:!0,characterData:!0})}#s(){let e=this.#e;!e||typeof ResizeObserver>"u"||(this.#i=new ResizeObserver(()=>{this.#n()}),this.#i.observe(e))}#n(){requestAnimationFrame(()=>this.#a())}#a(){let e=this.#e;if(!e||this.empty){this.isOverflowing=!1;return}this.isOverflowing=e.scrollHeight-e.clientHeight>1}disconnectedCallback(){super.disconnectedCallback(),this.#o?.disconnect(),this.#o=null,this.#i?.disconnect(),this.#i=null}};Yc([f],ci.prototype,"isOverflowing",void 0);Yc([f],ci.prototype,"userScrolledAway",void 0);c({mode:"boolean"})(ci.prototype,"busy");c({mode:"boolean"})(ci.prototype,"empty");var Xc={name:"violet-conversation-thread",template:bg,styles:gg};var Qc=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},yg=b`
    ${A}

:host{
display:block;
--_msg-border-width:var(--_card-border-width,1px);
--_msg-body-size:var(--violet-message-body-size,var(--_body-size));
--_msg-body-line:var(--violet-message-body-line,var(--_body-line));
--_msg-system-size:var(--violet-message-system-size,var(--_caption-size));
--_msg-meta-size:var(--violet-message-meta-size,var(--_meta-size));
}

.root{
display:flex;
gap:var(--_space-sm);
align-items:flex-start;
}

:host([message-role="user"]) .root{
flex-direction:row-reverse;
}

.avatar{
flex-shrink:0;
}

.avatar[hidden]{
display:none;
}

.surface{
box-sizing:border-box;
display:flex;
flex-direction:column;
gap:var(--_space-sm);
max-inline-size:85%;
min-inline-size:0;
padding:var(--_space-sm) var(--_space-md);
border-radius:var(--_radius-lg);
font-size:var(--_msg-body-size);
line-height:var(--_msg-body-line);
}


:host([message-role="assistant"]) .surface{
flex:1 1 auto;
max-inline-size:100%;
padding:0;
border:var(--_msg-border-width) solid transparent;
}

:host([message-role="user"]) .surface{
background:var(--_surface-subtle);
border:var(--_msg-border-width) solid transparent;
}

:host([message-role="system"]) .surface{
background:transparent;
border:var(--_msg-border-width) solid transparent;
max-inline-size:100%;
text-align:center;
font-size:var(--_msg-system-size);
color:var(--_text-muted);
}


:host([tone="error"]) .surface{
padding:var(--_space-sm) var(--_space-md);
border-color:var(--_danger-border);
background:var(--violet-color-state-danger-background,#f7e4df);
}

:host([tone="success"]) .surface{
padding:var(--_space-sm) var(--_space-md);
border-color:var(--_success-border);
background:var(--violet-color-state-success-background,#dfeae3);
}

:host([tone="muted"]) .surface{
opacity:0.7;
}

.meta{
display:flex;
align-items:center;
gap:var(--_space-sm);
font-size:var(--_msg-meta-size);
color:var(--_text-secondary);
}

.meta[hidden]{
display:none;
}

.body{
display:flex;
flex-direction:column;
gap:var(--_space-md);
min-inline-size:0;
}

@media (forced-colors:active){
.surface{
forced-color-adjust:none;
border:var(--_msg-border-width) solid ButtonText;
background:Canvas;
}
}
`,xg=h`
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
`,qt=class extends y{constructor(){super(),this.hasAvatar=!1,this.hasMeta=!1,this.messageRole="assistant",this.tone="default",this.streaming=!1}handleAvatarSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="avatar"]');this.hasAvatar=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleMetaSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="meta"]');this.hasMeta=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};Qc([f],qt.prototype,"hasAvatar",void 0);Qc([f],qt.prototype,"hasMeta",void 0);c({attribute:"message-role"})(qt.prototype,"messageRole");c(qt.prototype,"tone");c({mode:"boolean"})(qt.prototype,"streaming");var Jc={name:"violet-message",template:xg,styles:yg};var wg=b`
    ${A}

:host{
display:block;
--_cursor-width:var(--violet-cursor-width,0.125em);
--_cursor-height:var(--violet-cursor-height,1em);
--_cursor-gap:var(--violet-cursor-gap,0.125em);
}

.text{
display:grid;
align-content:start;
gap:var(--_space-stack-xs);
white-space:pre-wrap;
word-break:break-word;
margin:0;
line-height:inherit;
}

.content-slot{
display:block;
}

.content-slot::slotted(*){
margin:0;
}

.cursor{
display:inline-block;
inline-size:var(--_cursor-width);
block-size:var(--_cursor-height);
background:currentColor;
vertical-align:text-bottom;
margin-inline-start:var(--_cursor-gap);
animation:blink 0.8s step-end infinite;
}

.cursor[hidden]{
display:none;
}

@keyframes blink{
50%{opacity:0;}
}

@media (prefers-reduced-motion:reduce){
.cursor{
animation:none;
}
}
`,_g=h`
    <div class="text" part="text">
        <slot class="content-slot"></slot><span class="cursor" part="cursor" ?hidden="${t=>t.state!=="streaming"}" aria-hidden="true"></span>
    </div>
`,Jo=class extends y{constructor(){super(),this.state="done"}};c(Jo.prototype,"state");var Zc={name:"violet-message-text",template:_g,styles:wg};var kg=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Cg=b`
    ${A}

:host{
display:block;
--_media-max-width:var(--violet-media-max-width,100%);
--_media-max-height:var(--violet-media-max-height,300px);
--_media-font-size:var(--violet-media-font-size,var(--_caption-size));
--_media-line-height:var(--violet-media-line-height,var(--_caption-line));
}

.root{
display:flex;
flex-direction:column;
gap:var(--_space-sm);
max-inline-size:var(--_media-max-width);
}

.preview{
border-radius:var(--_radius-md);
overflow:hidden;
}

.preview img{
display:block;
max-inline-size:100%;
max-block-size:var(--_media-max-height);
object-fit:contain;
border-radius:var(--_radius-md);
}

.preview audio{
display:block;
inline-size:100%;
}

.preview video{
display:block;
max-inline-size:100%;
max-block-size:var(--_media-max-height);
border-radius:var(--_radius-md);
}

.file-row{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:var(--_space-sm) var(--_space-md);
border:var(--_card-border-width,1px) solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_surface-card);
}

.file-icon{
flex-shrink:0;
--violet-icon-size:var(--_media-line-height);
}

.file-info{
display:flex;
flex-direction:column;
min-inline-size:0;
}

.file-name{
font-size:var(--_media-font-size);
line-height:var(--_media-line-height);
color:var(--_text-primary);
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.file-type{
font-size:calc(var(--_media-font-size) * 0.85);
color:var(--_text-secondary);
}

@media (forced-colors:active){
.file-row{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
}
}
`,Sg=h`
    <div class="root" part="root">
        ${t=>t.renderMedia()}
    </div>
`,Ct=class extends y{constructor(){super(),this.failedSrc="",this.src="",this.mediaType="",this.filename="",this.alt="",this.allowedOrigins=""}connectedCallback(){super.connectedCallback(),Ir()}isSourceAllowed(){let e=this.allowedOrigins.trim();if(!e)return!0;let i;try{i=new URL(this.src,document.baseURI)}catch{return!1}return i.protocol==="data:"||i.protocol==="blob:"||i.origin===location.origin?!0:i.protocol!=="http:"&&i.protocol!=="https:"?!1:e.split(/\s+/).some(o=>{try{return new URL(o).origin===i.origin}catch{return!1}})}handleImageError(){this.failedSrc=this.src}renderMedia(){if(!this.src)return h``;if(!this.isSourceAllowed()||this.failedSrc===this.src)return this.renderFileRow();let e=this.mediaType.split("/")[0].toLowerCase();return e==="image"?h`
                <div class="preview" part="preview">
                    <img src="${i=>i.src}" alt="${i=>i.alt||i.filename||"Image"}" loading="lazy" referrerpolicy="no-referrer" @error="${i=>i.handleImageError()}" />
                </div>
            `:e==="audio"?h`
                <div class="preview" part="preview">
                    <audio controls preload="metadata">
                        <source src="${i=>i.src}" type="${i=>i.mediaType}" />
                    </audio>
                </div>
            `:e==="video"?h`
                <div class="preview" part="preview">
                    <video controls preload="metadata">
                        <source src="${i=>i.src}" type="${i=>i.mediaType}" />
                    </video>
                </div>
            `:this.renderFileRow()}renderFileRow(){return h`
            <div class="file-row">
                <span class="file-icon" part="icon"><violet-icon icon="system/attach" decorative></violet-icon></span>
                <div class="file-info">
                    <span class="file-name" part="filename">${e=>e.filename||"File"}</span>
                    <span class="file-type">${e=>e.mediaType||"Unknown type"}</span>
                </div>
            </div>
        `}};kg([f],Ct.prototype,"failedSrc",void 0);c(Ct.prototype,"src");c({attribute:"media-type"})(Ct.prototype,"mediaType");c(Ct.prototype,"filename");c(Ct.prototype,"alt");c({attribute:"allowed-origins"})(Ct.prototype,"allowedOrigins");var ed={name:"violet-message-media",template:Sg,styles:Cg};var zg=b`
    ${A}

:host{
display:block;
--_danger-text:var(--violet-color-state-danger-text,#c42a1a);
--_status-font-size:var(--violet-status-font-size,var(--_caption-size));
--_status-line-height:var(--violet-status-line-height,var(--_caption-line));
--_status-indicator-size:var(--violet-status-indicator-size,var(--_caption-line));
--_status-dot-size:calc(var(--_status-indicator-size) * 0.375);
--_status-streaming-dot-size:calc(var(--_status-indicator-size) * 0.25);
--_status-streaming-gap:calc(var(--_status-streaming-dot-size) * 0.75);
}

.root{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:var(--_space-sm) 0;
font-size:var(--_status-font-size);
line-height:var(--_status-line-height);
color:var(--_text-secondary);
}

.indicator{
display:inline-flex;
align-items:center;
justify-content:center;
flex-shrink:0;
inline-size:var(--_status-indicator-size);
block-size:var(--_status-indicator-size);
}

.dot{
inline-size:var(--_status-dot-size);
block-size:var(--_status-dot-size);
border-radius:var(--_radius-round);
background:currentColor;
}

:host([status="submitted"]) .dot{
animation:pulse 1.4s ease-in-out infinite;
}

:host([status="streaming"]) .indicator,
:host([status="retrying"]) .indicator{
display:inline-flex;
gap:var(--_status-streaming-gap);
}

.streaming-dot{
inline-size:var(--_status-streaming-dot-size);
block-size:var(--_status-streaming-dot-size);
border-radius:var(--_radius-round);
background:currentColor;
animation:bounce 1.2s ease-in-out infinite;
}

.streaming-dot:nth-child(2){
animation-delay:0.15s;
}

.streaming-dot:nth-child(3){
animation-delay:0.3s;
}

:host([status="error"]) .root{
color:var(--_danger-text);
}

:host([status="error"]) .dot{
background:var(--_danger-text);
}

.text{
min-inline-size:0;
}

@keyframes pulse{
0%,100%{opacity:1;}
50%{opacity:0.3;}
}

@keyframes bounce{
0%,60%,100%{transform:translateY(0);}
30%{transform:translateY(-4px);}
}

@media (prefers-reduced-motion:reduce){
:host([status="submitted"]) .dot,
.streaming-dot{
animation:none;
}
}

@media (forced-colors:active){
.root{
color:ButtonText;
}

:host([status="error"]) .root{
color:LinkText;
}
}
`,Eg=h`
    <div class="root" part="root" role="status" aria-live="polite">
        <span class="indicator" part="indicator">
            ${t=>t.status==="streaming"||t.status==="retrying"?h`
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                        <span class="streaming-dot" aria-hidden="true"></span>
                    `:h`<span class="dot" aria-hidden="true"></span>`}
        </span>
        <span class="text" part="text">
            <slot>${t=>t.defaultText()}</slot>
        </span>
    </div>
`,Zo=class extends y{constructor(){super(),this.status="streaming"}defaultText(){switch(this.status){case"submitted":return"Thinking\u2026";case"streaming":return"Responding\u2026";case"error":return"Something went wrong";case"cancelled":return"Stopped";case"retrying":return"Retrying\u2026";default:return""}}};c(Zo.prototype,"status");var td={name:"violet-message-status",template:Eg,styles:zg};var Tg=b`
    ${A}

:host{
display:block;
--_reasoning-bg:var(--violet-reasoning-bg,transparent);
--_reasoning-border:var(--violet-reasoning-border,transparent);
--_reasoning-font-size:var(--violet-reasoning-font-size,var(--_caption-size));
--_reasoning-line-height:var(--violet-reasoning-line-height,var(--_caption-line));
--_reasoning-toggle-size:var(--violet-reasoning-toggle-size,var(--_body-size));
}





.root{
border-radius:var(--_radius-md);
background:var(--_reasoning-bg);
box-shadow:0 0 0 var(--_card-border-width,1px) var(--_reasoning-border);
}

.toggle{
all:unset;
box-sizing:border-box;
display:flex;
align-items:center;
gap:var(--_space-sm);
border-radius:var(--_radius-sm);
font-size:var(--_reasoning-toggle-size);
color:var(--_text-muted);
cursor:pointer;
}

.toggle:hover{
color:var(--_text-primary);
}

.toggle:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}

.chevron{
display:inline-flex;
transition:transform 0.2s ease;
--violet-icon-size:var(--_reasoning-line-height);
}

:host([expanded]) .chevron{
transform:rotate(90deg);
}

.streaming-indicator{
display:none;
inline-size:var(--_reasoning-font-size);
block-size:var(--_reasoning-font-size);
border-radius:var(--_radius-round);
background:currentColor;
animation:pulse 1.4s ease-in-out infinite;
}

:host([state="streaming"]) .streaming-indicator{
display:inline-block;
}


.content{
padding-block-start:var(--_space-stack-xs);
padding-inline-start:calc(var(--_reasoning-line-height) + var(--_space-sm));
font-size:var(--_reasoning-font-size);
line-height:var(--_reasoning-line-height);
color:var(--_text-muted);
white-space:pre-wrap;
word-break:break-word;
}

.content[hidden]{
display:none;
}

@keyframes pulse{
0%,100%{opacity:1;}
50%{opacity:0.3;}
}

@media (prefers-reduced-motion:reduce){
.streaming-indicator{
animation:none;
}

.chevron{
transition:none;
}
}

@media (forced-colors:active){
.root{
forced-color-adjust:none;
background:Canvas;
box-shadow:0 0 0 var(--_card-border-width,1px) ButtonText;
}

.toggle:hover{
background:Highlight;
color:HighlightText;
}
}
`,$g=h`
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
`,zi=class extends y{constructor(){super(),this.expanded=!1,this.state="done",this.label="Thinking"}connectedCallback(){super.connectedCallback(),ft()}toggleExpanded(){this.expanded=!this.expanded}};c({mode:"boolean"})(zi.prototype,"expanded");c(zi.prototype,"state");c(zi.prototype,"label");var id={name:"violet-reasoning-block",template:$g,styles:Tg};var Ig=b`
    ${A}

:host{
display:inline-flex;
--_citation-font-size:var(--violet-citation-font-size,var(--_caption-size));
--_citation-line-height:var(--violet-citation-line-height,var(--_caption-line));
--_citation-badge-size:var(--violet-citation-badge-size,var(--_caption-line));
--_citation-max-width:var(--violet-citation-max-width,200px);
--_hc-border:var(--violet-hc-border,1px solid ButtonText);
}

.root{
display:inline-flex;
align-items:center;
gap:var(--_space-stack-xs);
font-size:var(--_citation-font-size);
line-height:var(--_citation-line-height);
}

.badge{
display:inline-flex;
align-items:center;
justify-content:center;
min-inline-size:var(--_citation-badge-size);
block-size:var(--_citation-badge-size);
padding-inline:var(--_space-stack-xs);
border-radius:var(--_radius-sm);
background:var(--_surface-subtle);
font-size:var(--_citation-font-size);
font-variant-numeric:tabular-nums;
font-weight:500;
color:var(--_text-secondary);
}

.badge[hidden]{
display:none;
}

.link{
color:var(--_text-link,var(--violet-color-accent-text,#1b5f80));
text-decoration:none;
max-inline-size:var(--_citation-max-width);
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.link:hover{
text-decoration:underline;
}

.link:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
border-radius:var(--_radius-sm);
}

.title{
color:var(--_text-primary);
max-inline-size:var(--_citation-max-width);
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.doc-icon{
display:inline-flex;
color:var(--_text-secondary);
--violet-icon-size:var(--_citation-line-height);
}

@media (forced-colors:active){
.link{
color:LinkText;
}

.badge{
forced-color-adjust:none;
border:var(--_hc-border);
background:Canvas;
}
}
`,Ag=h`
    <span class="root" part="root">
        <span class="badge" part="badge" ?hidden="${t=>!t.index}" aria-hidden="true">${t=>t.index}</span>
        ${t=>t.type==="url"&&t.href?Yr(t.href)?h`
                    <a class="link" part="link" href="${e=>e.href}" target="_blank" rel="noopener noreferrer">
                        ${e=>e.sourceTitle||e.href}
                    </a>
                `:h`
                        <span class="title" part="title">${e=>e.sourceTitle||e.href}</span>
                    `:h`
                <span class="doc-icon" part="icon"><violet-icon icon="system/document" decorative></violet-icon></span>
                <span class="title" part="title">${e=>e.sourceTitle||"Document"}</span>
            `}
        <slot></slot>
    </span>
`,St=class extends y{constructor(){super(),this.type="url",this.href="",this.sourceTitle="",this.sourceId="",this.mediaType="",this.index=""}connectedCallback(){super.connectedCallback(),ii()}};c(St.prototype,"type");c(St.prototype,"href");c({attribute:"source-title"})(St.prototype,"sourceTitle");c({attribute:"source-id"})(St.prototype,"sourceId");c({attribute:"media-type"})(St.prototype,"mediaType");c(St.prototype,"index");var od={name:"violet-source-citation",template:Ag,styles:Ig};var rd=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Rg=b`
    ${A}

:host{
display:block;
--_tool-font-size:var(--violet-tool-font-size,var(--_caption-size));
--_tool-line-height:var(--violet-tool-line-height,var(--_caption-line));
--_tool-name-size:var(--violet-tool-name-size,var(--violet-type-label-size,13px));
--_tool-icon-size:var(--violet-tool-name-size,var(--_body-size));
--_warning-bg:var(--violet-color-state-warning-background,#f3e8d2);
--_warning-text:var(--violet-color-state-warning-text,#92400e);
--_success-bg:var(--violet-color-state-success-background,#dfeae3);
--_success-text:var(--violet-color-state-success-text,#2c5e4b);
--_danger-bg:var(--violet-color-state-danger-background,#f7e4df);
--_danger-text-local:var(--violet-color-state-danger-text,#c42a1a);
}


.frame{
display:block;
--violet-card-radius:var(--_radius-md);
--violet-card-border-color:transparent;
--violet-card-background:var(--_surface-subtle);
--violet-card-shadow:none;
}

.frame::part(root){
overflow:hidden;
}

.approval-frame{
display:block;
}

.header{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:var(--_space-sm) var(--_space-md);
border-block-end:var(--_card-border-width,1px) solid transparent;
}

.icon{
flex-shrink:0;
display:inline-flex;
--violet-icon-size:var(--_tool-icon-size);
}


.name{
font-family: var(--violet-font-family-mono, "IBM Plex Mono", ui-monospace, Consolas, monospace);
font-size:var(--_tool-name-size);
font-weight:500;
color:var(--_text-primary);
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.badge{
flex-shrink:0;
margin-inline-start:auto;
padding:0 var(--_space-sm);
border-radius:var(--_radius-sm);
font-size:var(--_tool-font-size);
font-weight:500;
line-height:var(--_tool-line-height);
}

:host([state="pending"]) .badge,
:host([state="executing"]) .badge{
background:var(--_surface-subtle);
color:var(--_text-secondary);
}

:host([state="approval-requested"]) .badge{
background:var(--_warning-bg);
color:var(--_warning-text);
}

:host([state="output-available"]) .badge{
background:var(--_success-bg);
color:var(--_success-text);
}

:host([state="output-error"]) .badge{
background:var(--_danger-bg);
color:var(--_danger-text-local);
}

:host([state="cancelled"]) .badge{
background:var(--_surface-subtle);
color:var(--_text-secondary);
}

.body{
display:grid;
gap:var(--_space-stack-2xs);
padding:var(--_space-sm) var(--_space-md);
font-size:var(--_tool-font-size);
line-height:var(--_tool-line-height);
color:var(--_text-secondary);
}

.body:empty,
.body[hidden]{
display:none;
}

slot[name="summary"]::slotted(*),
slot[name="input"]::slotted(*),
slot[name="output"]::slotted(*),
.body slot::slotted(*){
margin:0;
}

.approval-summary{
display:grid;
gap:var(--_space-stack-2xs);
}

.approval-tool-name{
font-family: var(--violet-font-family-mono, "IBM Plex Mono", ui-monospace, Consolas, monospace);
font-size:var(--_tool-name-size);
font-weight:500;
line-height:var(--_body-line);
color:var(--_text-primary);
}

.approval-detail{
display:grid;
gap:var(--_space-stack-2xs);
}

.shimmer{
display:flex;
flex-direction:column;
gap:var(--_space-stack-xs);
}

.shimmer-line{
block-size:var(--_tool-line-height);
border-radius:var(--_radius-sm);
background:linear-gradient(90deg,
var(--_surface-subtle) 25%,
var(--_surface-hover) 50%,
var(--_surface-subtle) 75%);
background-size:200% 100%;
animation:shimmer 1.5s ease-in-out infinite;
}

.shimmer-line:last-child{
inline-size:60%;
}

.spinner{
display:inline-block;
inline-size:var(--_tool-line-height);
block-size:var(--_tool-line-height);
border:calc(var(--_tool-line-height) * 0.125) solid var(--_border-subtle);
border-block-start-color:var(--_text-secondary);
border-radius:var(--_radius-round);
animation:spin 0.8s linear infinite;
}

@keyframes shimmer{
0%{background-position:-200% 0;}
100%{background-position:200% 0;}
}

@keyframes spin{
to{transform:rotate(360deg);}
}

@media (prefers-reduced-motion:reduce){
.shimmer-line{
animation:none;
}

.spinner{
animation-duration:1.6s;
}
}

@media (forced-colors:active){




.frame > *{
forced-color-adjust:none;
}


slot{
forced-color-adjust:auto;
color:CanvasText;
}

.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
}

.badge{
border:var(--_card-border-width,1px) solid currentColor;
background:Canvas;
}


.header{
border-block-end-color:ButtonText;
}


.name,
.badge,
.body,
.approval-tool-name{
color:CanvasText;
}

violet-button,
violet-icon,
::slotted(violet-button),
::slotted(violet-icon){
forced-color-adjust:auto;
}
}
`,Dg=h`
    ${t=>t.state==="approval-requested"?h`
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
        `:h`
            <violet-card class="frame" part="root" appearance="outline" role="region" aria-label="${e=>`Tool: ${e.toolName}`}">
                <div class="header" part="header">
                    <span class="icon" part="icon">
                        <slot name="icon"><violet-icon icon="system/settings" decorative></violet-icon></slot>
                    </span>
                    <span class="name" part="name">${e=>e.toolName}</span>
                    <span class="badge" part="badge">${e=>e.badgeText()}</span>
                </div>
                <div class="body" part="body" ?hidden="${e=>e.state==="pending"||!e.hasBody}">
                    ${e=>e.state==="executing"?h`<span class="spinner" role="status" aria-label="Running"></span>`:""}
                    <slot name="summary" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot name="input" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot name="output" @slotchange="${e=>e.updateHasBody()}"></slot>
                    <slot @slotchange="${e=>e.updateHasBody()}"></slot>
                </div>
                ${e=>e.state==="pending"?h`
                    <div class="body">
                        <div class="shimmer" role="status" aria-label="Loading">
                            <div class="shimmer-line"></div>
                            <div class="shimmer-line"></div>
                        </div>
                    </div>
                `:""}
                ${e=>e.state==="executing"&&!e.hasBody?h`
                    <div class="body">
                        <span class="spinner" role="status" aria-label="Running"></span>
                    </div>
                `:""}
            </violet-card>
        `}
`,Wt=class extends y{constructor(){super(),this.toolName="",this.toolCallId="",this.state="pending",this.hasBody=!1,this.hasDetailContent=!1}connectedCallback(){super.connectedCallback(),xl(),this.updateHasBody()}updateHasBody(){let e=this.shadowRoot?.querySelector('slot[name="summary"]'),i=this.shadowRoot?.querySelectorAll('slot[name="input"], slot[name="output"], .body > slot:not([name]), .approval-detail > slot:not([name])')??[],o=(e?.assignedNodes({flatten:!0})??[]).some(n=>n.nodeType===Node.TEXT_NODE?!!n.textContent?.trim():!0),r=!1;for(let n of i)if(n.assignedNodes({flatten:!0}).some(a=>a.nodeType!==Node.TEXT_NODE||!!a.textContent?.trim())){r=!0;break}this.hasBody=o||r,this.hasDetailContent=r}badgeText(){switch(this.state){case"pending":return"Preparing\u2026";case"executing":return"Running\u2026";case"approval-requested":return"Needs approval";case"output-available":return"Complete";case"output-error":return"Error";case"cancelled":return"Cancelled";default:return""}}handleApprove(e){e?.stopPropagation(),this.$emit("approve",{toolCallId:this.toolCallId})}handleDeny(e){e?.stopPropagation(),this.$emit("deny",{toolCallId:this.toolCallId})}};rd([f],Wt.prototype,"hasBody",void 0);rd([f],Wt.prototype,"hasDetailContent",void 0);c({attribute:"tool-name"})(Wt.prototype,"toolName");c({attribute:"tool-call-id"})(Wt.prototype,"toolCallId");c(Wt.prototype,"state");var nd={name:"violet-tool-call-card",template:Dg,styles:Rg};var Fg=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Mg=b`
    ${A}

:host{
display:block;
--_result-font-size:var(--violet-result-font-size,var(--_caption-size));
--_result-line-height:var(--violet-result-line-height,var(--_caption-line));
--_success-text:var(--violet-color-state-success-text,#2c5e4b);
}


.frame{
display:block;
--violet-card-radius:var(--_radius-md);
--violet-card-border-color:transparent;
--violet-card-background:transparent;
--violet-card-shadow:none;
}


.frame::part(root){
overflow:visible;
}

.summary{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:0;
font-family:inherit;
font-size:var(--_result-font-size);
line-height:var(--_result-line-height);
color:var(--_text-muted);
cursor:pointer;
border:none;
border-radius:var(--_radius-sm);
background:none;
text-align:start;
}

.summary:hover{
color:var(--_text-primary);
}

.summary:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}

.status-icon{
flex-shrink:0;
display:inline-flex;
--violet-icon-size:var(--_result-line-height);
}

:host([state="output-available"]) .status-icon{
color:var(--_success-text);
}

:host([state="output-error"]) .status-icon{
color:var(--violet-color-state-danger-text,#c42a1a);
}

.summary-text{
flex:1;
min-inline-size:0;
}

slot[name="summary"]::slotted(*){
margin:0;
}

.chevron{
flex-shrink:0;
display:inline-flex;
transition:transform 0.2s ease;
--violet-icon-size:var(--_result-line-height);
}

:host([expanded]) .chevron{
transform:rotate(90deg);
}

.body{
display:grid;
gap:var(--_space-stack-2xs);
margin-block-start:var(--_space-stack-xs);
padding:var(--_space-sm) var(--_space-md);
border-block-start:var(--_card-border-width,1px) solid transparent;
border-radius:var(--_radius-md);
background:var(--_surface-subtle);
font-size:var(--_result-font-size);
line-height:var(--_result-line-height);
color:var(--_text-primary);
white-space:pre-wrap;
word-break:break-word;
}

.body[hidden]{
display:none;
}

.footer{
display:grid;
gap:var(--_space-stack-2xs);
margin-block-start:var(--_space-stack-xs);
padding:var(--_space-sm) var(--_space-md);
border-block-start:var(--_card-border-width,1px) solid transparent;
border-radius:var(--_radius-md);
background:var(--_surface-subtle);
font-size:var(--_result-font-size);
color:var(--_text-secondary);
}

.footer[hidden]{
display:none;
}

.body slot::slotted(*),
slot[name="footer"]::slotted(*){
margin:0;
}

.spinner{
display:inline-block;
inline-size:var(--_result-line-height);
block-size:var(--_result-line-height);
border:calc(var(--_result-line-height) * 0.125) solid var(--_border-subtle);
border-block-start-color:var(--_text-secondary);
border-radius:var(--_radius-round);
animation:spin 0.8s linear infinite;
}

@keyframes spin{
to{transform:rotate(360deg);}
}

@media (prefers-reduced-motion:reduce){
.spinner{
animation-duration:1.6s;
}

.chevron{
transition:none;
}
}

@media (forced-colors:active){




.frame > *{
forced-color-adjust:none;
}


slot{
forced-color-adjust:auto;
color:CanvasText;
}

.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
}


.body,
.footer{
border-block-start-color:ButtonText;
}


.summary,
.summary:hover,
.status-icon,
.body,
.footer{
color:CanvasText;
}

violet-button,
violet-icon,
::slotted(violet-button),
::slotted(violet-icon){
forced-color-adjust:auto;
}
}
`,Vg=h`
    <violet-card class="frame" part="root" appearance="outline">
        <button
            class="summary"
            part="summary"
            type="button"
            aria-expanded="${t=>String(t.expanded)}"
            @click="${t=>t.toggleExpanded()}"
        >
            <span class="status-icon" part="status-icon">
                ${t=>t.state==="output-error"?h`<violet-icon icon="system/dismiss" decorative></violet-icon>`:t.state==="output-available"?h`<violet-icon icon="system/checkmark" decorative></violet-icon>`:h`<span class="spinner" aria-label="In progress"></span>`}
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
`,Ei=class extends y{constructor(){super(),this.state="pending",this.expanded=!1,this.hasFooter=!1}connectedCallback(){super.connectedCallback(),ti(),We(),ft()}toggleExpanded(){this.expanded=!this.expanded}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}};Fg([f],Ei.prototype,"hasFooter",void 0);c(Ei.prototype,"state");c({mode:"boolean"})(Ei.prototype,"expanded");var sd={name:"violet-tool-result-card",template:Vg,styles:Mg};var ld=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},ad=0,Og=b`
    ${A}

:host{
--_dialog-border-width:var(--violet-dialog-border-width,var(--_card-border-width,1px));
--_dialog-padding:var(--violet-dialog-padding,var(--_space-md));
--_dialog-width:var(--violet-dialog-width,35rem);
--_dialog-margin:var(--violet-dialog-margin,2rem);
--_dialog-max-height:var(--violet-dialog-max-height,85vh);
--_dialog-radius:var(--violet-dialog-radius,calc(var(--_radius-lg) + 4px));
--_dialog-background:var(--violet-dialog-background,var(--_surface-floating));
--_dialog-shadow:var(--violet-dialog-shadow,var(--_shadow-floating));
--_dialog-backdrop:var(--violet-dialog-backdrop,rgba(0,0,0,0.4));
--_dialog-backdrop-off:transparent;
}

:host([no-backdrop]){
--_dialog-backdrop:transparent;
}

:host([padding="none"]){
--_dialog-padding:var(--violet-dialog-padding,0);
}

:host([padding="small"]){
--_dialog-padding:var(--violet-dialog-padding,var(--_space-sm));
}

:host([padding="large"]){
--_dialog-padding:var(--violet-dialog-padding,var(--_space-lg));
}

dialog{
box-sizing:border-box;
flex-direction:column;
inline-size:var(--_dialog-width);
max-inline-size:calc(100vw - var(--_dialog-margin));
max-block-size:min(var(--_dialog-max-height),calc(100vh - var(--_dialog-margin)));
margin:auto;
padding:0;

border:var(--_dialog-border-width) solid transparent;
border-radius:var(--_dialog-radius);
background:var(--_dialog-background);
box-shadow:var(--_dialog-shadow);
color:inherit;
font-family:inherit;
overflow:hidden;






opacity:0;
transition:
opacity var(--_duration-base) var(--_easing-standard),
display var(--_duration-base) var(--_easing-standard) allow-discrete,
overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
}







dialog[open]{
display:flex;
opacity:1;

@starting-style{
opacity:0;
}
}


dialog[open][data-initial-open]{
transition:none;

@starting-style{
opacity:1;
}
}

dialog::backdrop{
background:var(--_dialog-backdrop-off);
transition:
background var(--_duration-base) var(--_easing-standard),
display var(--_duration-base) var(--_easing-standard) allow-discrete,
overlay var(--_duration-base) var(--_easing-standard) allow-discrete;
}

dialog[open]::backdrop{
background:var(--_dialog-backdrop);

@starting-style{
background:var(--_dialog-backdrop-off);
}
}

dialog[open][data-initial-open]::backdrop{
transition:none;

@starting-style{
background:var(--_dialog-backdrop);
}
}

.header{
display:flex;
align-items:center;
gap:var(--_space-sm);

padding:var(--_dialog-padding) var(--_dialog-padding) 0;
border-block-end:var(--_dialog-border-width) solid transparent;
}

.header[hidden]{
display:none;
}

.title{
flex:1;
font-family:var(--violet-font-family-heading,var(--violet-font-family,var(--violet-font-family-body)));
font-size:var(--violet-type-heading-section-size,18px);
line-height:var(--violet-type-heading-section-line,24px);
font-weight:var(--violet-type-heading-section-weight,600);
letter-spacing:-0.01em;
min-inline-size:0;
}

.close-button{
flex-shrink:0;
}

.close-button[hidden]{
display:none;
}

.body{
flex:1;
padding:var(--_dialog-padding);
overflow-y:auto;
font-size:var(--_body-size);
line-height:var(--_body-line);
}

.footer{
display:flex;
align-items:center;
justify-content:flex-end;
gap:var(--_space-sm);
padding:var(--_dialog-padding);
border-block-start:var(--_dialog-border-width) solid var(--_border-subtle);

background:var(--_surface-subtle);
}

.footer[hidden]{
display:none;
}

@media (forced-colors:active){

dialog{
forced-color-adjust:none;
border:var(--_dialog-border-width) solid ButtonText;
background:Canvas;
box-shadow:none;
color:CanvasText;
}

slot{
forced-color-adjust:auto;
}

dialog::backdrop{
background:var(--_dialog-backdrop);
}

.header{
border-block-end-color:ButtonText;
}

.footer{
border-block-start-color:ButtonText;
background:Canvas;
}
}
`,Lg=h`
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
`;function Pg(){let t=document.activeElement;for(;t?.shadowRoot?.activeElement;)t=t.shadowRoot.activeElement;return t}var Ye=class extends y{#e=null;#t=!1;#o=null;#i=0;constructor(){super(),this.hasTitle=!1,this.hasFooter=!1,this.bodyScrollable=!1,this.open=!1,this.type="modal",this.padding="medium",this.noCloseButton=!1,this.noBackdrop=!1;let e=ad;ad+=1,this.dialogId=`violet-dialog-${e}`,this.titleId=`violet-dialog-title-${e}`,this.bodyId=`violet-dialog-body-${e}`}get returnValue(){return this.#r?.returnValue??""}set returnValue(e){let i=this.#r;i&&(i.returnValue=e)}get#r(){return this.shadowRoot?.querySelector("dialog")??null}show(){this.open=!0}hide(e){let i=this.#r;i&&e!==void 0&&(i.returnValue=e),this.open=!1}openChanged(){this.$fastController.isConnected&&(this.open?this.#s():this.#n())}typeChanged(){this.#c()}connectedCallback(){super.connectedCallback(),this.open&&this.#s(!0)}disconnectedCallback(){this.#a(),this.#r&&delete this.#r.dataset.initialOpen,this.#o?.disconnect(),this.#o=null,super.disconnectedCallback()}handleClose(e){this.#t=!0,this.open=!1,this.#t=!1,this.#o?.disconnect(),this.bodyScrollable=!1,this.$emit("open-change",{open:!1});let i=this.#e;i instanceof HTMLElement&&i.isConnected&&i.focus(),this.#e=null}handleBodySlotChange(){this.open&&this.#d()}handleCancel(e){e.preventDefault(),this.requestClose("keyboard")}requestClose(e){let i=new CustomEvent("request-close",{bubbles:!0,composed:!0,cancelable:!0,detail:{source:e}});this.dispatchEvent(i),i.defaultPrevented||this.hide()}handleTitleSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="title"]');this.hasTitle=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#s(e=!1){let i=this.#r;!i||i.open||(this.#a(),e?i.dataset.initialOpen="":delete i.dataset.initialOpen,this.#e=Pg(),this.#c(),this.type==="non-modal"?i.show():i.showModal(),e&&(this.#i=requestAnimationFrame(()=>{this.#i=requestAnimationFrame(()=>{this.#i=0,this.isConnected&&i.open&&delete i.dataset.initialOpen})})),this.#d(),this.$emit("open-change",{open:!0}))}#n(){let e=this.#r;this.#a(),e&&delete e.dataset.initialOpen,e?.open&&(this.#t||e.close())}#a(){this.#i&&(cancelAnimationFrame(this.#i),this.#i=0)}#d(){let e=this.shadowRoot?.querySelector(".body");if(!e)return;this.#o??=new ResizeObserver(()=>this.#l()),this.#o.disconnect(),this.#o.observe(e);let i=e.querySelector("slot");for(let o of i?.assignedElements({flatten:!0})??[])this.#o.observe(o);this.#l()}#l(){let e=this.shadowRoot?.querySelector(".body");this.bodyScrollable=!!(e&&e.scrollHeight>e.clientHeight)}#c(){let e=this.#r;e&&(this.type==="alert"?(e.setAttribute("role","alertdialog"),e.setAttribute("aria-describedby",this.bodyId),e.setAttribute("closedby","closerequest")):this.type==="non-modal"?(e.removeAttribute("role"),e.removeAttribute("aria-describedby"),e.setAttribute("closedby","any")):(e.removeAttribute("role"),e.removeAttribute("aria-describedby"),e.setAttribute("closedby","closerequest")))}};ld([f],Ye.prototype,"hasTitle",void 0);ld([f],Ye.prototype,"hasFooter",void 0);f(Ye.prototype,"bodyScrollable");c({mode:"boolean"})(Ye.prototype,"open");c(Ye.prototype,"type");c(Ye.prototype,"padding");c({attribute:"no-close-button",mode:"boolean"})(Ye.prototype,"noCloseButton");c({attribute:"no-backdrop",mode:"boolean"})(Ye.prototype,"noBackdrop");var cd={name:"violet-dialog",template:Lg,styles:Og};function dd(t){return typeof t=="object"?t.key:t}function ud(t,e){let i=t.length;return new Proxy(t,{get(o,r,n){if(typeof r=="string"){let s=r.charCodeAt(0);if(s>=48&&s<=57){let a=+r;if(Number.isInteger(a)&&a>=0&&a<i){let l=o[a];if(typeof l!="object"){let d=e[a*2];l=o[a]={index:a,key:l,start:d,size:e[a*2+1],end:d+e[a*2+1],lane:0}}return l}}if(r==="length")return i}return Reflect.get(o,r,n)}})}function Ti(t,e,i){let o=i.initialDeps??[],r,n=!0;function s(){var a;let d=0,u=t();if(!(u.length!==o.length||u.some((k,S)=>o[S]!==k)))return r;o=u;let v=0;return r=e(...u),i?.onChange&&!(n&&i.skipInitialOnChange)&&i.onChange(r),n=!1,r}return s.updateDeps=a=>{o=a},s}function Is(t,e){if(t===void 0)throw new Error(`Unexpected undefined${e?`: ${e}`:""}`);return t}var Kt=(t,e)=>Math.abs(t-e)<1.01,hd=(t,e,i)=>{let o;return Object.assign(function(...r){t.clearTimeout(o),o=t.setTimeout(()=>e.apply(this,r),i)},{cancel:()=>{t.clearTimeout(o)}})};function pd({offset:t,isScrolling:e,elementMax:i,holdOffset:o,scrollOffset:r,pendingWrite:n,clampedMaxAtWrite:s}){var a;return e&&n===null&&t===r?"spurious":n!==null&&Math.abs(t-n.target)<1.5?"readBack":n!==null&&!n.smooth&&i!==null&&n.target>i+o+.5&&Math.abs(t-(i+o))<1.5||n!==null&&!n.smooth&&((a=n.lowMaxes)!=null&&a.some(l=>Math.abs(t-l)<1.5))?"clampedReadBack":s!==null&&Math.abs(t-s)<1.5?"clampedEcho":"external"}var Bg=t=>t==="smooth"||t==="smoothFinishing";function fd({kind:t,offset:e,command:i,target:o}){return t!=="spurious"&&t!=="readBack"&&t!=="clampedReadBack"&&i?.index!=null&&i.phase!=="queued"&&!Bg(i.phase)&&!Kt(e,i.lastTargetOffset)&&!Kt(e,o())&&t!=="clampedEcho"}var As=40;function md(t){let e=t[t.length-1];if(e===void 0)return!1;let i=t.length-2;for(;i>=0&&e.t-t[i].t<As;)i--;if(i<0)return!1;let o=t[i],r=i-1;for(;r>=0&&o.t-t[r].t<As;)r--;if(r<0)return!1;let n=t[r],s=(e.offset-o.offset)/(e.t-o.t),a=(o.offset-n.offset)/(o.t-n.t);return s*a>=0&&Math.abs(s)>=2*Math.abs(a)&&Math.abs(s)-Math.abs(a)>=.8}function vd(t){let e=t[t.length-1];if(e===void 0)return!1;let i=t.length-2;for(;i>=0&&e.t-t[i].t<As;)i--;if(i<0)return!1;let o=t[i];return Math.abs(e.offset-o.offset)/(e.t-o.t)>=.05}var er,tr=()=>{if(er!==void 0)return er;if(typeof navigator>"u")return er=!1;if(/iP(hone|od|ad)/.test(navigator.userAgent))return er=!0;let t=navigator.maxTouchPoints;return er=navigator.platform==="MacIntel"&&t!==void 0&&t>0},Rs,Ng=()=>Rs!==void 0?Rs:Rs=tr()&&typeof CSS<"u"&&typeof CSS.supports=="function"&&CSS.supports("overflow-anchor: auto"),gd=()=>!tr()||Ng();var oo={capture:!0,passive:!0},Xr=class{constructor(e){this.host=e,this._touch=null,this.inMotion=()=>this._touch!==null&&this._touch.phase!=="lateFling",this.dragging=()=>{var i;return((i=this._touch)==null?void 0:i.phase)==="down"&&this._touch.moved},this.tail=()=>{var i;return((i=this._touch)==null?void 0:i.phase)==="tail"?this._touch.moved?"fling":"tap":null},this.onScroll=({isScrolling:i,ownReadBack:o,moved:r,external:n})=>{var s,a,l;return i&&((s=this._touch)==null?void 0:s.phase)==="tail"?this._openTail(this._touch.moved||!o,!1):((a=this._touch)==null?void 0:a.phase)==="lateFling"&&(this.host.now()>this._touch.until?this._touch=null:n&&i&&r&&this._openTail(!0,!1)),!o&&i&&r&&((l=this._touch)==null?void 0:l.phase)==="down"?(this._touch.moved=!0,!0):!1},this.touchStart=()=>{this.end(),this._touch={phase:"down",moved:!1}},this.touchEnd=()=>{var i;let o=((i=this._touch)==null?void 0:i.phase)==="down"&&this._touch.moved;this.end(),this._openTail(o,o)},this.end=()=>{var i;let o=this.host.getWindow();((i=this._touch)==null?void 0:i.phase)==="tail"&&o!=null&&o.clearTimeout(this._touch.timerId),this._touch=null},this.listen=i=>{let o=()=>this.touchStart(),r=()=>this.touchEnd();return i.addEventListener("touchstart",o,oo),i.addEventListener("touchend",r,oo),i.addEventListener("touchcancel",r,oo),()=>{i.removeEventListener("touchstart",o,oo),i.removeEventListener("touchend",r,oo),i.removeEventListener("touchcancel",r,oo),this.end()}},this._openTail=(i,o)=>{let r=this.host.getWindow();if(r==null)return;this.end();let n={phase:"tail",moved:i,awaitingFling:o,timerId:r.setTimeout(()=>{if(this.host.tailStillMoving()){this._openTail(n.moved,n.awaitingFling);return}this._touch=n.awaitingFling?{phase:"lateFling",until:this.host.now()+1e3}:null,this.host.onTailClosed()},150)};this._touch=n}}get touch(){return this._touch}};var bd=t=>{let{clientWidth:e,clientHeight:i}=t;return{width:e,height:i}},wd=t=>{let e=new Set;return{schedule:i=>{let o=t.requestAnimationFrame(()=>{e.delete(o),i()});e.add(o)},cancel:()=>{e.forEach(i=>t.cancelAnimationFrame(i)),e.clear()}}},Hg=t=>t,jg=t=>{let e=t.overscan*Math.max(t.lanes??1,1),i=Math.max(t.startIndex-e,0),r=Math.min(t.endIndex+e,t.count-1)-i+1,n=new Array(r);for(let s=0;s<r;s++)n[s]=i+s;return n},_d=(t,e)=>{let i=t.scrollElement;if(!i)return;let o=t.targetWindow;if(!o)return;let r=a=>{let{width:l,height:d}=a;e({width:Math.round(l),height:Math.round(d)})};if(r(bd(i)),!o.ResizeObserver)return()=>{};let n=wd(o),s=new o.ResizeObserver(()=>{let a=()=>{r(bd(i))};t.options.useAnimationFrameWithResizeObserver?n.schedule(a):a()});return s.observe(i,{box:"content-box"}),()=>{s.unobserve(i),n.cancel()}},yd={passive:!0};var qg=typeof window>"u"?!0:"onscrollend"in window,Wg=(t,e,i)=>{let o=t.scrollElement;if(!o)return;let r=t.targetWindow;if(!r)return;let n=t.options.useScrollendEvent&&qg,s=0,a=n?null:hd(r,()=>e(i(o),!1),t.options.isScrollingResetDelay),l=p=>()=>{s=i(o),a?.(),e(s,p)},d=l(!0),u=l(!1);return o.addEventListener("scroll",d,yd),n&&o.addEventListener("scrollend",u,yd),()=>{o.removeEventListener("scroll",d),n&&o.removeEventListener("scrollend",u),a?.cancel()}},kd=(t,e)=>Wg(t,e,i=>{let{horizontal:o,isRtl:r}=t.options;return o?i.scrollLeft*(r&&-1||1):i.scrollTop});var Kg=(t,e,i)=>{if(i.options.useCachedMeasurements){let o=i.indexFromElement(t),r=i.options.getItemKey(o);return i.itemSizeCache.get(r)??i.options.estimateSize(o)}if(e?.borderBoxSize){let o=e.borderBoxSize[0];if(o)return Math.round(o[i.options.horizontal?"inlineSize":"blockSize"])}if(!e){let o=i.indexFromElement(t),r=i.options.getItemKey(o),n=i.itemSizeCache.get(r);if(n!==void 0)return n}return t[i.options.horizontal?"offsetWidth":"offsetHeight"]},Ug=(t,{adjustments:e=0,behavior:i},o)=>{var r;let{scrollElement:n,options:s}=o,a=t+e,l=s.horizontal&&s.isRtl&&n!==null&&"ownerDocument"in n;(r=n?.scrollTo)==null||r.call(n,{[s.horizontal?"left":"top"]:l?-a:a,behavior:i})};var Cd=Ug,xd=(t,e)=>t==="smooth"?e?"smoothLanded":"smooth":"instant",ir=t=>t?.phase==="smooth"||t?.phase==="smoothLanded";function Gg(t,e,i,o){if(e===0)return!1;let r=o(0),n=new Set,s=0;for(;s<t;){let l=i(s);if(l===r)break;n.add(l),s++}let a=t-s;if(a===0||a>=e)return!1;for(let l=0;l<a;l++)if(o(l)!==i(s+l))return!1;for(let l=a;l<e;l++)if(n.has(o(l)))return!1;return!0}var Qr=class{constructor(e){this.unsubs=[],this.scrollElement=null,this.targetWindow=null,this.isScrolling=!1,this.scrollState=null,this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache=new Map,this.itemSizeCacheVersion=0,this.laneAssignments=new Map,this.pendingMin=null,this.prevLanes=void 0,this.lanesChangedFlag=!1,this.lanesSettling=!1,this.pendingScrollAnchor=null,this.scrollRect=null,this.scrollOffset=null,this.scrollDirection=null,this._holdOffset=0,this._reportedOverscroll=!1,this._iosGesture=new Xr({getWindow:()=>this.targetWindow,now:()=>this.now(),tailStillMoving:()=>{let i=this.scrollState;if(i?.phase!=="queued"||this.pendingWrite!==null)return!1;let o=this._readElementOffset();return o===null||this._lastElementOffset===null||Math.abs(o-this._lastElementOffset)<1?!1:(this._lastElementOffset=o,i.samples=[...i.samples??[],{t:this.now(),offset:o}],!0)},onTailClosed:()=>{let i=this.scrollState;i?.phase==="queued"&&vd(i.samples??[])&&(this.scrollState=null),this._flushHoldIfReady(!0),this._writeAwaitingCommand(),this._retryClampedAdjustment()}}),this._lastElementOffset=null,this.pendingWrite=null,this._clampedAdjustment=null,this.elementsCache=new Map,this._resizeBatch=null,this.now=()=>{var i,o,r;return((r=(o=(i=this.targetWindow)==null?void 0:i.performance)==null?void 0:o.now)==null?void 0:r.call(o))??Date.now()},this.observer=(()=>{let i=null,o=null,r=!1,n=!1,s=new Set,a=()=>{if(i)return i;let d=this.targetWindow;if(!d||!d.ResizeObserver)return null;let u=o=wd(d);return i=new d.ResizeObserver(p=>{let v=()=>{let k={sync:!1};this._resizeBatch=k;try{p.forEach(l)}finally{this._resizeBatch=null,k.notify&&(this.notify(k.sync),this._noteClampMax(),this._flushHoldIfReady(!0),this._retryClampedAdjustment(),this.measureElement(null))}};if(this.options.useAnimationFrameWithResizeObserver)u.schedule(v);else{r=!0;try{v()}finally{r=!1}}})},l=d=>{let u=d.target,p=this.indexFromElement(u);if(!u.isConnected){this.observer.unobserve(u);for(let[v,k]of this.elementsCache)if(k===u){this.elementsCache.delete(v);break}return}this.isIndexInRange(p)&&this.shouldMeasureDuringScroll(p)&&this.resizeItem(p,this.options.measureElement(u,d,this))};return{disconnect:()=>{var d;(d=a())==null||d.disconnect(),o?.cancel(),s.clear(),n=!1,i=null,o=null},observe:d=>{let u=a();if(u){if(!r){u.observe(d,{box:"border-box"});return}s.add(d),n||(n=!0,o?.schedule(()=>{n=!1,s.forEach(p=>{p.isConnected&&i?.observe(p,{box:"border-box"})}),s.clear()}))}},unobserve:d=>{var u;s.delete(d),(u=a())==null||u.unobserve(d)}}})(),this.range=null,this.setOptions=i=>{var o;let r={debug:!1,initialOffset:0,overscan:1,paddingStart:0,paddingEnd:0,scrollPaddingStart:0,scrollPaddingEnd:0,horizontal:!1,getItemKey:Hg,rangeExtractor:jg,onChange:()=>{},measureElement:Kg,initialRect:{width:0,height:0},scrollMargin:0,gap:0,indexAttribute:"data-index",initialMeasurementsCache:[],lanes:1,anchorTo:"start",followOnAppend:!1,scrollEndThreshold:1,isScrollingResetDelay:150,enabled:!0,isRtl:!1,useScrollendEvent:!1,useAnimationFrameWithResizeObserver:!1,laneAssignmentMode:"estimate",useCachedMeasurements:!1};for(let u in i){let p=i[u];p!==void 0&&(r[u]=p)}let n=this.options,s=null,a=null,l=!1;if(n!==void 0&&n.enabled&&r.enabled&&r.anchorTo==="end"&&this.scrollElement!==null){let u=n.count,p=r.count,v=this.getMeasurements(),k=((o=this._singleLaneMeasurements)==null?void 0:o.items)??v,S=D=>dd(k[D]),R=u>0?S(0):null,F=u>0?S(u-1):null;if(p!==u||u>0&&p>0&&(r.getItemKey(0)!==R||r.getItemKey(p-1)!==F)){l=!0;let D=u>0?this.getVirtualItemForOffset(this.getScrollOffset())??v[0]:null;D&&(s=[D.key,this.getScrollOffset()-D.start]);let O=r.followOnAppend===!0?"auto":r.followOnAppend||null;O&&p>0&&this.isAtEnd(n.scrollEndThreshold)&&(u===0||r.getItemKey(p-1)!==F)&&(p>u||Gg(u,p,S,r.getItemKey))&&(a=O)}}this.options=r,l&&(this.pendingMin=0,this.itemSizeCacheVersion++);let d=null;if(s&&this.scrollOffset!==null&&!this._awaitingCommandReadBack()){let[u,p]=s,v=this.getMeasurements(),{count:k,getItemKey:S}=this.options,R=0;for(;R<k&&S(R)!==u;)R++;if(R<k){let F=v[R];if(F){let _=Math.max(0,F.start+p);!a&&_!==this.scrollOffset&&(d=_-this.scrollOffset,this.scrollOffset=_)}}}a?this.pendingScrollAnchor={kind:"follow",behavior:a}:d!==null&&(this._canWriteScroll()?this.pendingScrollAnchor={kind:"anchor",delta:d}:(this._holdOffset+=d,this._followOffsetTarget(d)))},this.notify=i=>{var o,r;(r=(o=this.options).onChange)==null||r.call(o,this,i)},this.maybeNotify=Ti(()=>(this.calculateRange(),[this.isScrolling,this.range?this.range.startIndex:null,this.range?this.range.endIndex:null]),i=>{this.notify(i)},{key:!1,debug:()=>this.options.debug,initialDeps:[this.isScrolling,this.range?this.range.startIndex:null,this.range?this.range.endIndex:null]}),this.cleanup=()=>{var i;this.unsubs.filter(Boolean).forEach(o=>o()),this.unsubs=[],this.observer.disconnect(),this.rafId!=null&&this.targetWindow&&(this.targetWindow.cancelAnimationFrame(this.rafId),this.rafId=null),this.scrollState=null,(i=this._momentumStop)==null||i.restore(),this._momentumStop=null,this.isScrolling=!1,this.scrollDirection=null,this._holdOffset=0,this._reportedOverscroll=!1,this._clampedAdjustment=null,this.pendingWrite=null,this.scrollElement=null,this.targetWindow=null},this._didMount=()=>()=>{this.cleanup()},this._willUpdate=()=>{var i;let o=this.options.enabled?this.options.getScrollElement():null;if(this.scrollElement!==o){if(this.cleanup(),!o){this.maybeNotify();return}this.scrollElement=o,this.scrollElement&&"ownerDocument"in this.scrollElement?this.targetWindow=this.scrollElement.ownerDocument.defaultView:this.targetWindow=((i=this.scrollElement)==null?void 0:i.window)??null,this.elementsCache.forEach(n=>{this.observer.observe(n)}),this.unsubs.push(this.options.observeElementRect(this,n=>{this.scrollRect=n,this.maybeNotify()})),this.unsubs.push(this.options.observeElementOffset(this,(n,s)=>{var a,l,d,u;let p=s?this._elementMaxScrollOffset():null,v=this._reportedOverscroll;this._reportedOverscroll=n<0||p!==null&&n>p+1;let k=n;this._lastElementOffset=k,n=this._toLayoutOffset(n);let S=this._classifyScrollEvent(n,s,p);if(S==="spurious")return;S==="readBack"?n=this.pendingWrite.target:S==="clampedReadBack"&&((a=this.scrollState)==null?void 0:a.index)!=null&&n<this.getMaxScrollOffset()-1.5?this.scrollState.lastTargetOffset=n:fd({kind:S,offset:n,command:this.scrollState,target:()=>this.getScrollStateTarget(this.scrollState)})&&(this.scrollState=null),this.pendingWrite=null,this._clampedAdjustment!==null&&Math.abs(n-this._clampedAdjustment.maxAtWrite)>=1.5&&(this._clampedAdjustment=null);let R=this.getScrollOffset(),F=this.scrollDirection;this.scrollDirection=s?R===n?this.scrollDirection:R<n?"forward":"backward":null,this.scrollOffset=n,this.isScrolling=s;let _=this.scrollState;if(_?.phase==="queued"&&S==="external"&&s)if(v||this._reportedOverscroll)_.samples=[];else{let $=this.now();_.samples=[...(_.samples??[]).filter(D=>$-D.t<=200),{t:$,offset:k}],(F!==null&&this.scrollDirection!==F||md(_.samples))&&(this.scrollState=null)}this._iosGesture.onScroll({isScrolling:s,ownReadBack:S==="readBack",moved:n!==R,external:S==="external"&&((l=this.scrollState)==null?void 0:l.phase)!=="smooth"&&((d=this.scrollState)==null?void 0:d.phase)!=="smoothFinishing"})&&((u=this.scrollState)==null?void 0:u.phase)==="queued"&&(this.scrollState=null),this._flushHoldIfReady(!0),this.scrollState&&this.scheduleScrollReconcile(),this.maybeNotify()})),"addEventListener"in this.scrollElement&&this.unsubs.push(this._iosGesture.listen(this.scrollElement)),this._scrollToOffset(this.getScrollOffset())}this._noteClampMax();let r=this.pendingScrollAnchor;this.pendingScrollAnchor=null,r&&this.scrollElement&&this.options.enabled&&(r.kind==="anchor"?this._canWriteScroll()?ir(this.scrollState)&&!Kt(this.getScrollOffset()-r.delta,this.scrollState.lastTargetOffset)||(this._followOffsetTarget(r.delta),this._scrollToOffset(this.getScrollOffset())):(this._holdOffset+=r.delta,this._followOffsetTarget(r.delta),this.notify(!1)):this.scrollToEnd({behavior:r.behavior})),this._flushHoldIfReady(!1),this._retryClampedAdjustment()},this._classifyScrollEvent=(i,o,r)=>{var n;return pd({offset:i,isScrolling:o,elementMax:r,holdOffset:this._holdOffset,scrollOffset:this.scrollOffset,pendingWrite:this.pendingWrite,clampedMaxAtWrite:((n=this._clampedAdjustment)==null?void 0:n.maxAtWrite)??null})},this._retryClampedAdjustment=()=>{if(this._clampedAdjustment===null||!this.scrollElement||!this.options.enabled||!this._canWriteScroll())return;let{target:i,maxAtWrite:o}=this._clampedAdjustment,r=this.getMaxScrollOffset();r>o+.5&&(this._clampedAdjustment=i>r+.5?{target:i,maxAtWrite:r}:null,this._scrollToOffset(i))},this._writeAwaitingCommand=()=>{let i=this.scrollState;if(i===null||i.phase!=="queued")return;let{behavior:o}=i;this.getMeasurements();let r=this.getScrollStateTarget(i);i.lastTargetOffset=r,this._clampedAdjustment=null,i.phase=xd(o,i.index!=null&&Kt(r,this.getScrollOffset())),this._scrollToOffset(r,{behavior:o}),this.scheduleScrollReconcile()},this._readElementOffset=()=>{let i=this.scrollElement;if(i==null)return null;let{horizontal:o,isRtl:r}=this.options;return typeof i.scrollTop=="number"?o?i.scrollLeft*(r&&-1||1):i.scrollTop:typeof i.scrollY=="number"?o?i.scrollX:i.scrollY:null},this._canWriteScroll=()=>!(tr()&&this._iosGesture.inMotion())&&!this._reportedOverscroll,this._flushHoldIfReady=i=>{var o;if(this._holdOffset===0||!this.scrollElement||!this.options.enabled||!this._canWriteScroll()||((o=this.scrollState)==null?void 0:o.phase)==="smooth")return;this._holdOffset=0,this.scrollOffset!==null&&this.scrollOffset<0&&(this.scrollOffset=0),this.notify(i);let r=this.getCommandWrittenOffset()??this.getScrollOffset();this._clampedAdjustment=this._clampedBy(r),this._scrollToOffset(r)},this.rafId=null,this.getSize=()=>this.options.enabled?(this.scrollRect=this.scrollRect??this.options.initialRect,this.scrollRect[this.options.horizontal?"width":"height"]):(this.scrollRect=null,0),this.getScrollOffset=()=>this.options.enabled?(this.scrollOffset=this.scrollOffset??(typeof this.options.initialOffset=="function"?this.options.initialOffset():this.options.initialOffset),this.scrollOffset):(this.scrollOffset=null,0),this.getMeasurementOptions=Ti(()=>[this.options.count,this.options.paddingStart,this.options.scrollMargin,this.options.getItemKey,this.options.enabled,this.options.lanes,this.options.laneAssignmentMode,this.options.gap],(i,o,r,n,s,a,l,d)=>(this.prevLanes!==void 0&&this.prevLanes!==a&&(this.lanesChangedFlag=!0),this.prevLanes=a,this.pendingMin=null,{count:i,paddingStart:o,scrollMargin:r,getItemKey:n,enabled:s,lanes:a,laneAssignmentMode:l,gap:d}),{key:!1}),this.isIndexInRange=i=>i>=0&&i<this.options.count,this.getMeasurements=Ti(()=>[this.getMeasurementOptions(),this.itemSizeCacheVersion],({count:i,paddingStart:o,scrollMargin:r,getItemKey:n,enabled:s,lanes:a,laneAssignmentMode:l,gap:d},u)=>{var p;let v=this.itemSizeCache;if(!s)return this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),[];if(this.laneAssignments.size>i)for(let $ of this.laneAssignments.keys())$>=i&&this.laneAssignments.delete($);this.lanesChangedFlag&&(this.lanesChangedFlag=!1,this.lanesSettling=!0,this.measurementsCache=[],this._singleLaneMeasurements=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),this.pendingMin=null),this.measurementsCache.length===0&&!this.lanesSettling&&(this.measurementsCache=this.options.initialMeasurementsCache,this.measurementsCache.forEach($=>{this.itemSizeCache.set($.key,$.size)}));let k=this.lanesSettling?0:this.pendingMin??0;if(this.pendingMin=null,this.lanesSettling&&this.measurementsCache.length===i&&(this.lanesSettling=!1),a===1){let $=i*2,D=(p=this._singleLaneMeasurements)==null?void 0:p.flat;if(!D||D.length<$){let W=new Float64Array($);D&&k>0&&W.set(D.subarray(0,k*2)),D=W}let O=k===0?new Array(i):this._singleLaneMeasurements.items.slice(),L;if(k===0)L=o+r;else{let W=k-1;L=D[W*2]+D[W*2+1]+d}for(let W=k;W<i;W++){let ge=n(W);O[W]=ge;let Te=v.get(ge),ut=typeof Te=="number"?Te:this.options.estimateSize(W);D[W*2]=L,D[W*2+1]=ut,L+=ut+d}this._singleLaneMeasurements={flat:D,items:O};let P=ud(O,D);return this.measurementsCache=P,P}let S=this.measurementsCache.slice(0,k),R=new Array(a).fill(void 0),F=new Float64Array(a),_=0;for(let $=0;$<k;$++){let D=S[$];D&&(R[D.lane]===void 0&&_++,R[D.lane]=$,F[D.lane]=D.end)}for(let $=k;$<i;$++){let D=n($),O=this.laneAssignments.get($),L,P,W=l==="estimate"||v.has(D);if(O!==void 0&&this.options.lanes>1){L=O;let Oe=R[L],qe=Oe!==void 0?S[Oe]:void 0;P=qe?qe.end+d:o+r}else if(_===a){let Oe=0,qe=F[0],Jt=R[0];for(let ht=1;ht<a;ht++){let Ro=F[ht];(Ro<qe||Ro===qe&&R[ht]<Jt)&&(Oe=ht,qe=Ro,Jt=R[ht])}L=Oe,P=qe+d,W&&this.laneAssignments.set($,L)}else L=$%this.options.lanes,P=o+r,W&&this.laneAssignments.set($,L);let ge=v.get(D),Te=typeof ge=="number"?ge:this.options.estimateSize($),ut=P+Te;S[$]={index:$,start:P,size:Te,end:ut,key:D,lane:L},R[L]===void 0&&_++,R[L]=$,F[L]=ut}return this.measurementsCache=S,S},{key:!1,debug:()=>this.options.debug}),this.calculateRange=Ti(()=>[this.getMeasurements(),this.getSize(),this.getScrollOffset(),this.options.lanes,this._getLayoutTotalSize()+this.options.scrollMargin],(i,o,r,n,s)=>{if(i.length===0||o===0)return this.range=null,null;let a=Math.max(s-o,0);return this.range=Xg(i,o,Math.min(r,a),n,n===1&&this._singleLaneMeasurements!==null?this._singleLaneMeasurements.flat:null),this.range},{key:!1,debug:()=>this.options.debug}),this.getVirtualIndexes=Ti(()=>{let i=null,o=null,r=this.calculateRange();return r&&(i=r.startIndex,o=r.endIndex),this.maybeNotify.updateDeps([this.isScrolling,i,o]),[this.options.rangeExtractor,this.options.overscan,this.options.count,i,o,this.options.lanes]},(i,o,r,n,s,a)=>n===null||s===null?[]:i({startIndex:n,endIndex:s,overscan:o,count:r,lanes:a}),{key:!1,debug:()=>this.options.debug}),this.indexFromElement=i=>{let o=this.options.indexAttribute,r=i.getAttribute(o);return r?parseInt(r,10):(console.warn(`Missing attribute name '${o}={index}' on measured element.`),-1)},this.shouldMeasureDuringScroll=i=>{var o;if(!ir(this.scrollState))return!0;let r=this.scrollState.index??((o=this.getVirtualItemForOffset(this.scrollState.lastTargetOffset))==null?void 0:o.index);if(r!==void 0&&this.range){let n=Math.max(this.options.overscan,Math.ceil((this.range.endIndex-this.range.startIndex)/2)),s=Math.max(0,r-n),a=Math.min(this.options.count-1,r+n);return i>=s&&i<=a}return!0},this.measureElement=i=>{if(!i){this.elementsCache.forEach((s,a)=>{s.isConnected||(this.observer.unobserve(s),this.elementsCache.delete(a))});return}let o=this.indexFromElement(i);if(!this.isIndexInRange(o))return;let r=this.options.getItemKey(o),n=this.elementsCache.get(r);n!==i&&(n&&this.observer.unobserve(n),this.observer.observe(i),this.elementsCache.set(r,i)),i.isConnected&&(!this.isScrolling||this.scrollState)&&this.shouldMeasureDuringScroll(o)&&this.resizeItem(o,this.options.measureElement(i,void 0,this))},this.resizeItem=(i,o)=>{var r,n,s;if(!this.isIndexInRange(i))return;(r=this._resizeBatch)!=null&&r.sync&&this.getMeasurements();let a,l,d,u=(n=this._singleLaneMeasurements)==null?void 0:n.flat;if(this.options.lanes===1&&u!=null)d=this.options.getItemKey(i),l=u[i*2],a=u[i*2+1];else{let k=this.measurementsCache[i];if(!k)return;d=k.key,l=k.start,a=k.size}let p=this.itemSizeCache.get(d)??a,v=o-p;if(v!==0){let k=this.options.anchorTo==="end"&&!ir(this.scrollState)&&this.getVirtualDistanceFromEnd()<=this.options.scrollEndThreshold,S=k?this._getLayoutTotalSize():0,R=this.getScrollOffset(),_=!this.itemSizeCache.has(d)?l<R:l+p<=R&&this.scrollDirection!=="backward",$=!ir(this.scrollState)&&(this.shouldAdjustScrollPositionOnItemSizeChange!==void 0?this.shouldAdjustScrollPositionOnItemSizeChange(this.measurementsCache[i]??{index:i,key:d,start:l,size:a,end:l+a,lane:0},v,this):_);(this.pendingMin===null||i<this.pendingMin)&&(this.pendingMin=i),this.itemSizeCache.set(d,o),this.itemSizeCacheVersion++;let D=!1;if(this._awaitingCommandReadBack()||(k?D=this.applyScrollAdjustment(this._getLayoutTotalSize()-S):$&&(D=this.applyScrollAdjustment(v))),this._resizeBatch){this._resizeBatch.notify=!0,(s=this._resizeBatch).sync||(s.sync=D);return}this.notify(D),this._noteClampMax(),this._flushHoldIfReady(!0),this._retryClampedAdjustment()}},this.getVirtualItems=Ti(()=>[this.getVirtualIndexes(),this.getMeasurements(),this._holdOffset],(i,o,r)=>{let n=[];for(let s=0,a=i.length;s<a;s++){let l=i[s],d=o[l];n.push(r===0?d:{...d,start:d.start-r,end:d.end-r})}return n},{key:!1,debug:()=>this.options.debug}),this.getVirtualItemForOffset=i=>{var o;let r=this.getMeasurements();if(r.length===0)return;let n=(o=this._singleLaneMeasurements)==null?void 0:o.flat,s=this.options.lanes===1&&n!=null,a=Sd(0,r.length-1,s?l=>n[l*2]:l=>Is(r[l]).start,i);return Is(r[a])},this._noteClampMax=()=>{if(!this._awaitingCommandReadBack())return;let i=this._elementMaxScrollOffset();if(i===null)return;let o=this.pendingWrite,r=Math.max(i,0)+this._holdOffset;if(r>=o.target)return;let n=o.lowMaxes??(o.lowMaxes=[]);n[n.length-1]!==r&&n.push(r)},this.getMaxScrollOffset=()=>(this._elementMaxScrollOffset()??0)+this._holdOffset,this._toLayoutOffset=i=>{var o;let r=i+this._holdOffset;return((o=this.pendingScrollAnchor)==null?void 0:o.kind)==="anchor"&&(r+=this.pendingScrollAnchor.delta),r},this._elementMaxScrollOffset=()=>{let i=this.scrollElement;if(i===null)return null;if("scrollHeight"in i)return this.options.horizontal?i.scrollWidth-i.clientWidth:i.scrollHeight-i.clientHeight;if("document"in i){let o=i.document.documentElement;return this.options.horizontal?o.scrollWidth-i.innerWidth:o.scrollHeight-i.innerHeight}return null},this._momentumStop=null,this._stopMomentum=i=>{let o=this.scrollElement,r=this.targetWindow;if(o===null||r===null)return;let n="document"in o?o.document.scrollingElement:o;if(!n?.style)return;if(this._momentumStop){this._momentumStop.done=i;return}let{style:s}=n,a=this.options.horizontal?"overflow-x":"overflow-y",l=s.getPropertyValue(a),d=s.getPropertyPriority(a),u=()=>this.options.horizontal?n.clientHeight:n.clientWidth,p=u();if(s.setProperty(a,"hidden","important"),u()!==p){s.setProperty(a,l,d);return}let v={restore:()=>s.getPropertyValue(a)!=="hidden"||s.getPropertyPriority(a)!=="important"?!1:(s.setProperty(a,l,d),!0),done:i};this._momentumStop=v,r.requestAnimationFrame(()=>r.requestAnimationFrame(()=>{this._momentumStop===v&&(this._momentumStop=null,v.restore()&&v.done())}))},this._clampedBy=i=>{let o=this._elementMaxScrollOffset();if(o===null)return null;let r=o+this._holdOffset;return i>r+.5?{target:i,maxAtWrite:r}:null},this.getVirtualDistanceFromEnd=()=>Math.max(this._getLayoutTotalSize()+this.options.scrollMargin-this.getSize()-this.getScrollOffset(),0),this.getDistanceFromEnd=()=>Math.max(this.getMaxScrollOffset()-this.getScrollOffset(),0),this.isAtEnd=(i=this.options.scrollEndThreshold)=>this.getDistanceFromEnd()<=i,this.getOffsetForAlignment=(i,o,r=0)=>{if(!this.scrollElement)return 0;let n=this.getSize(),s=this.getScrollOffset();o==="auto"&&(o=i>=s+n?"end":"start"),o==="center"?i+=(r-n)/2:o==="end"&&(i-=n);let a=this.getMaxScrollOffset();return Math.max(Math.min(a,i),0)},this.getOffsetForIndex=(i,o="auto")=>{i=Math.max(0,Math.min(i,this.options.count-1));let r=this.getSize(),n=this.getScrollOffset(),s=this.getMeasurements()[i];if(!s)return;if(o==="auto")if(s.end>=n+r-this.options.scrollPaddingEnd)o="end";else if(s.start<=n+this.options.scrollPaddingStart)o="start";else return[n,o];if(o==="end"&&i===this.options.count-1){let l=this.getMaxScrollOffset(),d=l-this.options.paddingEnd+this.options.scrollPaddingEnd;return[Math.max(Math.min(d,l),0),o]}let a=o==="end"?s.end+this.options.scrollPaddingEnd:s.start-this.options.scrollPaddingStart;return[this.getOffsetForAlignment(a,o,s.size),o]},this.scrollToOffset=(i,{align:o="start",behavior:r="auto"}={})=>{this._startScroll({index:null,align:o},this.getOffsetForAlignment(i,o),r,"absolute")},this.scrollToIndex=(i,{align:o="auto",behavior:r="auto"}={})=>{i=Math.max(0,Math.min(i,this.options.count-1));let n=this.getOffsetForIndex(i,o);if(!n)return;let[s,a]=n;this._startScroll({index:i,align:a},s,r,"absolute")},this.scrollBy=(i,{behavior:o="auto"}={})=>{let r=this.getOffsetForAlignment((this.getCommandWrittenOffset()??this.getScrollOffset())+i,"start");this._startScroll({index:null,align:"start"},r,o,"relative")},this.scrollToEnd=({behavior:i="auto"}={})=>{if(this.options.count>0){this._startScroll({index:this.options.count-1,align:"end",toEnd:!0},Math.max(this.getMaxScrollOffset(),0),i,"absolute");return}this.scrollToOffset(Math.max(this.getTotalSize()-this.getSize(),0),{behavior:i})},this.cancelScroll=()=>{this.rafId!=null&&this.targetWindow&&(this.targetWindow.cancelAnimationFrame(this.rafId),this.rafId=null),this.scrollState=null},this.getTotalSize=()=>Math.max(this._getLayoutTotalSize()-this._holdOffset,0),this._getLayoutTotalSize=()=>{var i,o;let r=this.getMeasurements(),n;if(r.length===0)n=this.options.paddingStart;else if(this.options.lanes===1){let s=r.length-1,a=(i=this._singleLaneMeasurements)==null?void 0:i.flat;a!=null?n=a[s*2]+a[s*2+1]:n=((o=r[s])==null?void 0:o.end)??0}else{let s=Array(this.options.lanes).fill(null),a=r.length-1;for(;a>=0&&s.some(l=>l===null);){let l=r[a];s[l.lane]===null&&(s[l.lane]=l.end),a--}n=Math.max(...s.filter(l=>l!==null))}return Math.max(n-this.options.scrollMargin+this.options.paddingEnd,0)},this.takeSnapshot=()=>{let i=[];if(this.itemSizeCache.size===0)return i;let o=this.getMeasurements();for(let r of o)r&&this.itemSizeCache.has(r.key)&&i.push({index:r.index,key:r.key,start:r.start,size:r.size,end:r.end,lane:r.lane});return i},this._scrollToOffset=(i,{adjustments:o,behavior:r}={})=>{let n={target:i+(o??0),smooth:r==="smooth"};return this.pendingWrite=n,this.options.scrollToFn(i-this._holdOffset,{behavior:r,adjustments:o},this),n},this.getCommandWrittenOffset=()=>this.scrollState!==null&&this.pendingWrite!==null&&!this.pendingWrite.smooth?this.pendingWrite.target:null,this._awaitingCommandReadBack=()=>{let i=this.getCommandWrittenOffset();return!(tr()&&this._iosGesture.dragging())&&i!==null&&!Kt(i,this.getScrollOffset())},this._followOffsetTarget=i=>{this.scrollState!==null&&this.scrollState.index==null&&(this.scrollState.lastTargetOffset+=i)},this.measure=()=>{this.pendingMin=null,this.itemSizeCache.clear(),this.laneAssignments.clear(),this.itemSizeCacheVersion++,this.notify(!1)},this.setOptions(e)}get scrollAdjustments(){return 0}applyScrollAdjustment(e,i){if(e===0)return!1;if(this._followOffsetTarget(e),this._canWriteScroll()){let o=this.getScrollOffset();this._clampedAdjustment=this._clampedBy(o+e);let r=this._scrollToOffset(o,{adjustments:e,behavior:i});return this.scrollOffset!==null&&(this.pendingWrite===r&&(this.scrollOffset+=e),this.scrollOffset<0&&(this.scrollOffset=0)),!0}else return this._holdOffset+=e,this.scrollOffset!==null&&(this.scrollOffset+=e),!0}scheduleScrollReconcile(){if(!this.targetWindow){this.scrollState=null;return}this.rafId==null&&(this.rafId=this.targetWindow.requestAnimationFrame(()=>{this.rafId=null,this.reconcileScroll()}))}getScrollStateTarget(e){let i=e.toEnd?[Math.max(this.getMaxScrollOffset(),0)]:e.index!=null?this.getOffsetForIndex(e.index,e.align):void 0;return i?i[0]:e.lastTargetOffset}reconcileScroll(){if(!this.scrollState||!this.scrollElement)return;if(this.now()-this.scrollState.startedAt>5e3){this.scrollState=null;return}if(this.scrollState.phase==="queued"){this.scheduleScrollReconcile();return}this.getMeasurements();let o=this.getScrollStateTarget(this.scrollState),r=this.scrollState.index==null?1:this.options.useAnimationFrameWithResizeObserver?3:2,n=o!==this.scrollState.lastTargetOffset;if(!n&&Kt(o,this.getScrollOffset())){if(this.scrollState.phase==="smooth"?this.scrollState.phase="smoothLanded":this.scrollState.phase==="smoothFinishing"&&(this.scrollState.phase="instant"),this.scrollState.stableFrames++,this.scrollState.stableFrames>=r){this.getScrollOffset()!==o&&this._scrollToOffset(o,{behavior:"auto"}),this.scrollState=null;return}}else if(this.scrollState.stableFrames=0,n){let s=this.getSize()||600,a=Math.abs(o-this.getScrollOffset()),l=ir(this.scrollState)&&a>s;this.scrollState.lastTargetOffset=o,l?this.scrollState.phase="smooth":this.scrollState.phase==="smooth"?this.scrollState.phase="smoothFinishing":this.scrollState.phase==="smoothLanded"&&(this.scrollState.phase="instant"),this._scrollToOffset(o,{behavior:l?"smooth":"auto"})}this.scheduleScrollReconcile()}_startScroll(e,i,o,r){this.pendingScrollAnchor=null,this._clampedAdjustment=null;let n=this._iosGesture.tail();if(r==="absolute"&&n!==null){if(n==="fling"&&gd()){this._stopMomentum(()=>{let s=this.scrollState;s?.phase!=="queued"||this._iosGesture.tail()!=="fling"||this._reportedOverscroll||(this._iosGesture.end(),this._flushHoldIfReady(!0),this._writeAwaitingCommand())}),this.scrollState={...e,startedAt:this.now(),lastTargetOffset:i,stableFrames:0,phase:"queued",behavior:o,samples:[]},this.scheduleScrollReconcile();return}this._iosGesture.end()}this.scrollState={...e,startedAt:this.now(),lastTargetOffset:i,stableFrames:0,behavior:o,phase:xd(o,e.index!=null&&Kt(i,this.getScrollOffset()))},this._scrollToOffset(i,{behavior:o}),this.scheduleScrollReconcile()}},Sd=(t,e,i,o)=>{for(;t<=e;){let r=(t+e)/2|0,n=i(r);if(n<o)t=r+1;else if(n>o)e=r-1;else return r}return t>0?t-1:0};function Yg(t,e,i){let o=0;for(;o<=e;){let r=(o+e)/2|0,n=t[r*2];if(n<i)o=r+1;else if(n>i)e=r-1;else return r}return o>0?o-1:0}function Xg(t,e,i,o,r){let n=t.length-1;if(t.length<=o)return{startIndex:0,endIndex:n};if(o===1&&r!==null){let d=Yg(r,n,i),u=d,p=i+e;for(;u<n&&r[u*2]+r[u*2+1]<p;)u++;return{startIndex:d,endIndex:u}}let a=Sd(0,n,d=>t[d].start,i),l=a;if(o===1)for(;l<n&&t[l].end<i+e;)l++;else if(o>1){let d=Array(o).fill(0);for(;l<n&&d.some(p=>p<i+e);){let p=t[l];d[p.lane]=p.end,l++}let u=Array(o).fill(i+e);for(;a>=0&&u.some(p=>p>=i);){let p=t[a];u[p.lane]=p.start,a--}a=Math.max(0,a-a%o),l=Math.min(n,l+(o-1-l%o))}return{startIndex:a,endIndex:l}}var zd=b`
:host{
display:block;
container-type:inline-size;
color:var(--violet-color-text-primary,#181b1a);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_surface-selected:var(--violet-color-surface-selected,#dfecf4);
--_control-selected-background:var(--violet-color-control-selected-background,#c0daeb);
--_control-selected-foreground:var(--violet-color-control-selected-foreground,#1b5f80);
--_control-selected-border:var(--violet-color-control-selected-border,rgba(27,95,128,0.5));
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_error-background:var(--violet-color-state-danger-background,#f7e4df);
--_error-border:var(--violet-color-state-danger-border,transparent);
--_error-text:var(--violet-color-state-danger-text,#c42a1a);
--_active-cell-ring:var(--violet-data-grid-active-cell-ring,color-mix(in srgb,var(--_focus-ring) 82%,transparent));
--_active-cell-ring-width:var(--violet-data-grid-active-cell-ring-width,var(--violet-size-focus-ring-width,2px));
--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_space-inline-md:var(--violet-space-inline-group,8px);
--_space-stack-xs:var(--violet-space-stack-tight,4px);
--_space-stack-sm:var(--violet-space-stack-group,8px);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-card:var(--violet-shadow-card,0 0 0 1px rgba(24,27,26,0.06),0 1px 2px rgba(24,27,26,0.06),0 4px 10px -2px rgba(24,27,26,0.06));





--_layer-raised:var(--violet-z-index-raised,1);
--_layer-sticky:var(--violet-z-index-sticky,10);
--_focus-outline-offset:2px;
--_type-meta-size:0.875rem;
--_type-cell-size:0.9375rem;
--_target-size-compact:var(--violet-size-target-compact,24px);
--_target-size-natural:var(--violet-size-target-natural,32px);
--_target-size-comfortable:var(--violet-size-target-comfortable,44px);
--_row-target-size:var(--_target-size-natural);
--_column-resizer-target-size:var(--_target-size-compact);
--_filter-max-inline:min(24rem,100%);
--_toolbar-primary-column:20rem;
--_selection-column-size:3.25rem;
--_selection-control-size:1rem;
--_loading-min-block-size:10rem;
--_overlay-blur:4px;
--_visually-hidden-size:1px;
--_row-padding-inline:var(--violet-data-grid-row-padding-inline,0.875rem);
--_virtualized-max-block-size:var(--violet-data-grid-virtualized-max-block-size,32rem);
}

:host([density="compact"]){
--_row-target-size:var(--_target-size-compact);
--_row-padding-inline:var(--violet-data-grid-row-padding-inline-compact,0.875rem);
}

:host([density="comfortable"]){
--_row-target-size:var(--_target-size-comfortable);
--_row-padding-inline:var(--violet-data-grid-row-padding-inline-comfortable,1rem);
}

:host(:focus-visible){
outline:2px solid var(--_focus-ring);
outline-offset:var(--_focus-outline-offset);
}

:host([busy]) .table-scroll{
cursor:progress;
}

.grid-shell{
display:grid;
gap:var(--_space-stack-sm);
min-inline-size:0;
min-block-size:0;
block-size:100%;
}

.toolbar{
display:grid;
gap:var(--_space-inline-sm);
align-items:start;
}

.fill-actions{
display:flex;
flex-wrap:wrap;
gap:var(--_space-inline-sm);
}

.fill-status{
align-self:center;
color:var(--_text-secondary);
font-size:var(--_type-meta-size);
}

.fill-action{
min-inline-size:24px;
min-block-size:32px;
padding:var(--_space-stack-xs) var(--_space-inline-md);
border:1px solid var(--_border-strong);
border-radius:var(--_radius-md);
background:var(--_surface-card);
color:var(--_text-primary);
font:inherit;
font-size:var(--_type-meta-size);
cursor:pointer;
}

.fill-action:disabled{
color:var(--_text-muted);
cursor:default;
}

.fill-action:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:var(--_focus-outline-offset);
}

.toolbar-meta{
display:flex;
justify-content:space-between;
align-items:center;
gap:var(--_space-inline-sm);
color:var(--_text-secondary);
font-size:var(--_type-meta-size);
}

.toolbar-slot{
display:flex;
flex-wrap:wrap;
gap:var(--_space-inline-sm);
}

.filter-shell{
display:grid;
max-inline-size:var(--_filter-max-inline);
}

.filter-field{
inline-size:100%;
}

.table-region{
position:relative;
min-inline-size:0;
min-block-size:0;
}

.edit-status{
position:absolute;
z-index:var(--_layer-sticky);
inset-block-start:var(--_space-stack-xs);
inset-inline-end:var(--_space-inline-sm);
max-inline-size:min(24rem,calc(100% - (var(--_space-inline-sm) * 2)));
padding:var(--_space-stack-xs) var(--_space-inline-sm);
border:1px solid var(--_error-border);
border-radius:calc(var(--_radius-md) / 2);
background:var(--_error-background);
color:var(--_error-text);
box-shadow:var(--_shadow-card);
font-size:0.8125rem;
line-height:1.35;
pointer-events:none;
}

.edit-status:empty{
display:none;
}

.table-scroll{
box-sizing:border-box;
max-inline-size:100%;
min-inline-size:0;
overflow:auto;
border:1px solid var(--_border-subtle);
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_surface-card);
scrollbar-color:color-mix(in srgb,var(--_border-strong) 65%,transparent) transparent;
outline:none;
}

.table-scroll:focus-visible{
box-shadow:0 0 0 2px var(--_focus-ring);
}

:host([virtualize]) .table-scroll{
block-size:100%;
max-block-size:var(--_virtualized-max-block-size);
overflow-anchor:none;
}

.table-canvas{
--_virtual-total-size:0px;
min-inline-size:100%;
overflow:visible;
}

:host([virtualize]) .table-canvas{
min-block-size:calc(var(--_virtual-total-size,0px) + var(--_row-target-size));
}

.table-scroll::-webkit-scrollbar{
inline-size:0.625rem;
block-size:0.625rem;
}

.table-scroll::-webkit-scrollbar-track{
background:transparent;
}

.table-scroll::-webkit-scrollbar-thumb{
background:color-mix(in srgb,var(--_border-strong) 72%,transparent);
border-radius:999px;
border:2px solid transparent;
background-clip:padding-box;
}

.table-scroll::-webkit-scrollbar-corner{
background:transparent;
}

.table-full-table{
min-inline-size:100%;
inline-size:max-content;
border-collapse:separate;
border-spacing:0;
table-layout:fixed;
}

thead{
background:var(--_surface-subtle);
}

:host([sticky-header]) .table-full-table thead th{
position:sticky;
inset-block-start:0;
z-index:var(--_layer-raised);
background:var(--_surface-subtle);
}

th,
td{
box-sizing:border-box;
block-size:var(--_row-target-size);
border-block-end:1px solid var(--_border-subtle);
padding-inline:var(--_row-padding-inline);
padding-block:0;
text-align:start;
vertical-align:middle;
}

tbody tr:last-of-type td{
border-block-end:none;
}

.virtual-spacer-row,
.virtual-spacer-row td{
padding:0;
border:0;
background:transparent;
overflow-anchor:none;
}

.virtual-spacer-row td{
min-block-size:0;
}

th{
color:var(--_text-secondary);
font-size:var(--_type-meta-size);
font-weight:600;
position:relative;
}

th[data-column-id]{
padding-inline-end:var(--_column-resizer-target-size);
}

th:not(:last-child),
td:not(:last-child){
border-inline-end:1px solid var(--_border-subtle);
}

.header-button{
display:inline-flex;
align-items:center;
justify-content:space-between;
gap:var(--_space-inline-sm);
inline-size:100%;
block-size:100%;
padding:0;
padding-inline-end:calc(var(--_space-inline-sm) + 0.5rem);
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:inherit;
cursor:pointer;
}

.header-button:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:var(--_focus-outline-offset);
border-radius:calc(var(--_radius-md) / 2);
}

th[tabindex]:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:-2px;
}

.header-label{
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.sort-indicator{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
color:var(--_text-muted);
flex:0 0 auto;
transition:
opacity 120ms ease,
color 120ms ease;
}

.sort-indicator[data-sorted="false"]{
opacity:0;
color:color-mix(in srgb,var(--_text-muted) 72%,var(--_surface-card));
}

th:hover .sort-indicator[data-sorted="false"],
.header-button:hover .sort-indicator[data-sorted="false"],
.header-button:focus-visible .sort-indicator[data-sorted="false"]{
opacity:1;
}

.column-resizer{
position:absolute;
inset-block:0;
inset-inline-end:0;
box-sizing:border-box;
inline-size:var(--_column-resizer-target-size);
padding:0;
border:none;
background:transparent;
cursor:col-resize;
touch-action:none;
z-index:var(--_layer-sticky);
}

.column-resizer::before{
content: "";
position:absolute;
inset-block:0;
inset-inline-end:0;
inline-size:1px;
background:color-mix(in srgb,var(--_border-strong) 58%,transparent);
opacity:0;
transition:opacity 120ms ease;
}

th:hover .column-resizer::before,
.column-resizer:focus-visible::before{
opacity:1;
}

.column-resizer:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:1px;
border-radius:999px;
}

td{
background:var(--_surface-page);
color:var(--_text-primary);
font-size:var(--_type-cell-size);
position:relative;
user-select:text;
-webkit-user-select:text;
}

:host([focus-mode="cell"]) td{
user-select:none;
-webkit-user-select:none;
}

td[data-selected="true"]{
background:color-mix(in srgb,var(--_surface-selected) 48%,var(--_surface-page));
}

td[data-fill-preview="true"]{
background:color-mix(in srgb,var(--_surface-selected) 62%,var(--_surface-page));
}

td[data-active="true"]::after{
content: "";
position:absolute;
inset:calc(-1 * var(--_active-cell-ring-width));
pointer-events:none;
z-index:var(--_layer-raised);
border:var(--_active-cell-ring-width) solid var(--_active-cell-ring);
box-sizing:border-box;
}

td[tabindex]:focus{
outline:none;
}

td[tabindex]:focus-visible::after{
border-color:var(--_focus-ring);
}

@media (forced-colors:active){
td[tabindex]:focus-visible{
outline:2px solid Highlight;
outline-offset:-2px;
}
}

td[data-active="true"]{
background:color-mix(in srgb,var(--_surface-selected) 70%,var(--_surface-page));
}


.fill-handle{
position:absolute;
inset-inline-end:0;
inset-block-end:0;
inline-size:24px;
block-size:24px;
touch-action:none;
cursor:crosshair;
z-index:var(--_layer-sticky);
}

.fill-handle::after{
content: "";
position:absolute;
inset-inline-end:-3px;
inset-block-end:-3px;
inline-size:6px;
block-size:6px;
border:1px solid var(--_active-cell-ring);
border-radius:2px;
background:var(--_surface-card);
pointer-events:none;
box-shadow:0 0 0 1px var(--_surface-card);
}

.cell-content{
display:block;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.cell-widget{
display:inline-grid;
align-items:center;
justify-items:start;
inline-size:100%;
min-inline-size:0;
}

.cell-sizing-content{
display:block;
visibility:hidden;
pointer-events:none;
}

.cell-widget[data-align="center"]{
justify-items:center;
}

.cell-checkbox{
display:inline-grid;
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
line-height:0;
--violet-checkbox-inline-target-size:var(--_selection-control-size);
}

.cell-radio{
display:inline-grid;
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
line-height:0;
--violet-radio-inline-target-size:var(--_selection-control-size);
--violet-radio-inline-gap:0;
}

.cell-editor{
position:absolute;
inset-inline-start:var(--_row-padding-inline);
inset-inline-end:var(--_row-padding-inline);
inset-block-start:50%;
transform:translateY(-50%);
display:block;
box-sizing:border-box;
inline-size:auto;
min-inline-size:0;
max-inline-size:calc(100% - (var(--_row-padding-inline) * 2));
padding:0;
border:none;
background:transparent;
color:var(--_text-primary);
font:inherit;
line-height:inherit;
text-align:inherit;
outline:none;
appearance:none;
}

violet-data-grid-pill-select.cell-editor{
inset-inline-start:var(--_row-padding-inline);
inset-inline-end:auto;
inset-block-start:50%;
transform:translateY(-50%);
display:inline-grid;
inline-size:fit-content;
max-inline-size:calc(100% - (var(--_row-padding-inline) * 2));
justify-self:start;
z-index:var(--_layer-raised);
}

input.cell-editor[type="number"]{
appearance:textfield;
-moz-appearance:textfield;
}

input.cell-editor[type="number"]::-webkit-outer-spin-button,
input.cell-editor[type="number"]::-webkit-inner-spin-button{
margin:0;
-webkit-appearance:none;
}

.cell-editor:focus{
outline:none;
}

.cell-editor-hint{
box-sizing:border-box;
position:absolute;

z-index:calc(var(--_layer-sticky) + 1);
inset-inline-start:var(--_row-padding-inline);
inset-block-start:calc(100% - var(--_space-stack-xs));

inline-size:max-content;
max-inline-size:18rem;
overflow-y:auto;
padding:2px var(--_space-stack-xs);
border:1px solid var(--_border-strong);
border-radius:calc(var(--_radius-md) / 2);
background:var(--_surface-floating);
color:var(--_text-primary);
box-shadow:var(--_shadow-card);
font-size:0.75rem;
line-height:1.25;
white-space:normal;
}

.cell-editor-error{
box-sizing:border-box;
position:absolute;
z-index:calc(var(--_layer-sticky) + 1);
inset-inline-start:var(--_row-padding-inline);
inset-block-start:calc(100% - var(--_space-stack-xs));
max-inline-size:calc(100% - (var(--_row-padding-inline) * 2));
overflow-y:auto;
padding:2px var(--_space-stack-xs);
border:1px solid var(--_error-border);
border-radius:calc(var(--_radius-md) / 2);
background:var(--_error-background);
color:var(--_error-text);
box-shadow:var(--_shadow-card);
font-size:0.75rem;
line-height:1.25;
white-space:normal;
}

.cell-editor-hint[data-placement="above"],
.cell-editor-error[data-placement="above"]{
inset-block-start:auto;
inset-block-end:calc(100% - var(--_space-stack-xs));
}

.selection-cell,
.selection-header{
inline-size:var(--_selection-column-size);
padding-inline:0;
line-height:0;
text-align:center;
}

.selection-control{
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
accent-color:var(--_control-selected-foreground);
user-select:auto;
-webkit-user-select:auto;
}

.selection-checkbox{
display:block;
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
line-height:0;
justify-self:center;
--violet-checkbox-inline-target-size:var(--_selection-control-size);
user-select:auto;
-webkit-user-select:auto;
}

.selection-radio{
display:block;
inline-size:var(--_selection-control-size);
block-size:var(--_selection-control-size);
line-height:0;
justify-self:center;
--violet-radio-inline-target-size:var(--_selection-control-size);
--violet-radio-inline-gap:0;
user-select:auto;
-webkit-user-select:auto;
}

tbody tr[data-selected="true"]{
background:var(--_surface-selected);
}

tbody tr[data-selected="true"] td{
color:var(--_text-primary);
}

.loading-state,
.empty-state{
display:grid;
place-items:center;
gap:var(--_space-stack-xs);
min-block-size:var(--_loading-min-block-size);
padding:calc(var(--_row-padding-inline) * 1.5);
text-align:center;
color:var(--_text-secondary);
background:var(--_surface-card);
}

.loading-overlay{
position:absolute;
inset:1px;
display:grid;
place-items:center;
padding:var(--_space-inline-md);
border-radius:calc(var(--_radius-md) - 2px);
background:var(
--violet-data-grid-loading-overlay-background,
color-mix(in srgb,var(--_surface-card) 58%,transparent)
);
color:var(--_text-secondary);
backdrop-filter:blur(calc(var(--_overlay-blur) * 1.75));
-webkit-backdrop-filter:blur(calc(var(--_overlay-blur) * 1.75));
}

.default-slot{
display:contents;
}

.visually-hidden{
position:absolute;
inline-size:var(--_visually-hidden-size);
block-size:var(--_visually-hidden-size);
padding:0;
margin:-1px;
overflow:hidden;
clip:rect(0,0,0,0);
white-space:nowrap;
border:0;
}

th[data-align="center"],
td[data-align="center"]{
text-align:center;
}

th[data-align="end"],
td[data-align="end"]{
text-align:end;
}

@container (min-width:48rem){
.toolbar{
grid-template-columns:minmax(0,var(--_toolbar-primary-column)) minmax(0,1fr);
align-items:end;
}

.toolbar-meta{
justify-content:flex-end;
}
}
`;var ro=h`
    <span class="cell-content">${t=>t.text}</span>
`,Ed=h`
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
`,Td=h`
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
        ${N(t=>t.editorOptions,h`
                <option value="${t=>t.value}">${t=>t.label}</option>
            `)}
    </select>
`;function $d(t){return t.button!==0?null:{pointerId:t.pointerId,columnId:t.columnId,startX:t.clientX,startWidth:t.startWidth}}function Jr(t,e){return t.pointerId!==null&&t.columnId!==null&&e===t.pointerId}function Ds(t){return Math.max(t.minimumWidth,Math.round(t.session.startWidth+(t.clientX-t.session.startX)))}var Qg=8,Jg=32;function Id(t){if(t.key!=="ArrowLeft"&&t.key!=="ArrowRight")return null;let e=t.shiftKey?Jg:Qg,i=t.key==="ArrowRight"!==t.rtl;return Math.max(t.minimumWidth,Math.round(t.currentWidth+(i?e:-e)))}function Fs(){return{pointerId:null,columnId:null,startX:0,startWidth:0}}var Zr="Control+Alt+R";function en(t){return t.ctrlKey&&t.altKey&&!t.metaKey&&!t.shiftKey&&t.code==="KeyR"}function Ad(t){return t==null?"":String(t)}function or(t){if(typeof t=="boolean")return t;if(typeof t=="number")return Number.isFinite(t)&&t!==0;if(typeof t=="string"){let e=t.trim().toLowerCase();return e==="true"||e==="1"||e==="yes"||e==="on"}return!1}function Ms(t,e){if(t.parse)return t.parse(e,t.rowData);if(t.editor==="checkbox")return or(e);if(t.editor==="number"){let i=String(e??"");if(i.trim()==="")return null;let o=Number(i);return Number.isNaN(o)?i:o}return e}function Rd(t,e){if(t.editor==="number"&&!t.parse){let i=String(e??"");if(i.trim()!==""&&!Number.isFinite(Number(i)))return{valid:!1,message:"Enter a valid number."}}try{return{valid:!0,value:Ms(t,e)}}catch(i){return{valid:!1,message:i instanceof Error&&i.message.trim()?i.message:"Enter a valid value."}}}function Dd(t){return t==="select"||t==="custom"}var Zg=h`
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
            part="${(t,e)=>e.parent.focusMode==="cell"&&e.parent.isSelectionCellActive(t.row.id)?"cell active-cell":"cell"}"
            role="${(t,e)=>e.parent.focusMode==="cell"&&e.parent.selectionMode!=="none"?"gridcell":null}"
            aria-colindex="${(t,e)=>e.parent.selectionMode==="none"?null:"1"}"
            tabindex="${(t,e)=>e.parent.selectionCellTabIndexFor(t.row.id)}"
            data-selection-row-id="${t=>t.row.id}"
            data-active="${(t,e)=>e.parent.focusMode==="cell"?String(e.parent.isSelectionCellActive(t.row.id)):null}"
            headers="${(t,e)=>e.parent.selectionHeaderId}"
            ?hidden="${(t,e)=>e.parent.selectionMode==="none"}"
        >
            ${g((t,e)=>e.parent.selectionMode==="single",h`
                    <violet-radio
                        class="selection-radio"
                        inline
                        value="${t=>t.row.id}"
                        name="${(t,e)=>e.parent.selectionControlName}"
                        aria-label="${(t,e)=>e.parent.selectionLabelFor(t.row.id,t.row.label)}"
                        :checked="${(t,e)=>e.parent.isRowSelected(t.row.id)}"
                        :managedTabIndex="${(t,e)=>e.parent.rowSelectionControlTabIndexFor(t.row.id)}"
                        @pointerdown="${(t,e)=>e.parent.handleSelectionControlPointerDown(e.event)}"
                        @click="${(t,e)=>e.parent.handleSelectionControlClick(e.event)}"
                        @change="${(t,e)=>e.parent.handleRowSelection(t.row.id,e.event)}"
                    ></violet-radio>
                `)}
            ${g((t,e)=>e.parent.selectionMode==="multiple",h`
                    <violet-checkbox
                        class="selection-checkbox"
                        inline
                        tabindex="${(t,e)=>String(e.parent.rowSelectionControlTabIndexFor(t.row.id))}"
                        aria-label="${(t,e)=>e.parent.selectionLabelFor(t.row.id,t.row.label)}"
                        :checked="${(t,e)=>e.parent.isRowSelected(t.row.id)}"
                        @pointerdown="${(t,e)=>e.parent.handleSelectionControlPointerDown(e.event)}"
                        @click="${(t,e)=>e.parent.handleRowCheckboxClick(t.row.id,e.event)}"
                    ></violet-checkbox>
                `)}
        </td>
        ${N(t=>t.row.cells,h`
                <td
                    id="${t=>t.cellId}"
                    role="${(t,e)=>e.parentContext.parent.focusMode==="cell"?"gridcell":null}"
                    aria-colindex="${(t,e)=>String(e.parentContext.parent.columnAriaColIndexFor(t.columnId))}"
                    aria-selected="${(t,e)=>e.parentContext.parent.cellAriaSelectedFor(t)}"
                    tabindex="${(t,e)=>e.parentContext.parent.cellTabIndexFor(t.rowId,t.columnId)}"
                    aria-keyshortcuts="${(t,e)=>e.parentContext.parent.focusMode==="cell"?Zr:null}"
                    aria-describedby="${(t,e)=>e.parentContext.parent.cellAriaDescribedByFor(t)}"
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
                    ${g(t=>t.editing&&(t.editor==="text"||t.editor==="number"),h`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${ki(t=>t,t=>t.cellTemplate??ro)}
                            </span>
                            ${Ed}
                        `)}
                    ${g(t=>t.editing&&t.editor==="select",h`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${ki(t=>t,t=>t.cellTemplate??ro)}
                            </span>
                            ${Td}
                        `)}
                    ${g(t=>t.editing&&t.editor==="custom",h`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${ki(t=>t,t=>t.cellTemplate??ro)}
                            </span>
                            ${ki(t=>t,t=>t.editorTemplate??ro)}
                        `)}
                    ${g(t=>!t.editing&&t.editor==="checkbox",h`
                            <span class="cell-widget" data-align="${t=>t.align}">
                                <violet-checkbox
                                    class="cell-checkbox"
                                    data-cell-widget="checkbox"
                                    inline
                                    tabindex="${(t,e)=>String(e.parentContext.parent.cellCheckboxTabIndexFor(t.rowId,t.columnId))}"
                                    aria-label="${t=>`${t.columnLabel} for ${t.rowLabel}`}"
                                    :checked="${t=>or(t.rawValue)}"
                                    ?disabled="${t=>!t.editable}"
                                    @click="${(t,e)=>e.parentContext.parent.handleCellCheckboxClick(t.rowId,t.columnId,e.event)}"
                                ></violet-checkbox>
                            </span>
                        `)}
                    ${g(t=>t.editing&&!!t.editingError,h`
                          <span
                              class="cell-editor-error"
                              id="${t=>t.editingErrorId}"
                              role="alert"
                          >${t=>t.editingError}</span>
                      `)}
                    ${g(t=>t.editing&&!!t.editingHint,h`
                          <span class="cell-editor-hint" id="${t=>t.editingHintId}"
                          >${t=>t.editingHint}</span>
                      `)}
                    ${g(t=>!t.editing&&t.editor!=="checkbox",h`
                            ${ki(t=>t,t=>t.cellTemplate??ro)}
                        `)}
                    ${g((t,e)=>e.parentContext.parent.shouldShowFillHandleForCell(t.rowId,t.columnId),h`
                            <span class="fill-handle" data-fill-handle="true" aria-hidden="true"></span>
                        `)}
                </td>
            `)}
    </tr>
`,eb=h`
    <div class="table-canvas" style="--_virtual-total-size:${t=>`${t.virtualTotalSize}px`};">
        <table
            class="table-full-table"
            part="table"
            role="${t=>t.focusMode==="cell"?"grid":null}"
            aria-multiselectable="${t=>t.focusMode==="cell"?"true":null}"
            aria-label="${t=>t.hostAriaLabel}"
            aria-rowcount="${t=>String(t.logicalRowCount)}"
            aria-colcount="${t=>String(t.logicalColumnCount)}"
        >
        <colgroup>
            <!-- With selection off the selection cells are hidden, so the column is hidden too: a hidden <col>
                 creates no column slot, and a visible one would shift every cell one slot to the left. -->
            <col
                class="selection-column"
                ?hidden="${t=>t.selectionMode==="none"}"
                style="width:var(--_selection-column-size);inline-size:var(--_selection-column-size);min-inline-size:var(--_selection-column-size);max-inline-size:var(--_selection-column-size);"
            />
                ${N(t=>t.presentedColumns,h`
                    <col data-column-id="${t=>t.id}" style="${t=>t.widthStyle}" />
                `)}
        </colgroup>
        <thead part="head">
            <tr part="header-row" aria-rowindex="1">
                <th
                    id="${t=>t.selectionHeaderId}"
                    class="selection-header"
                    part="header-cell selection-header-cell"
                    scope="col"
                    aria-colindex="${t=>t.selectionMode==="none"?null:"1"}"
                    aria-label="${t=>t.selectionHeaderLabel}"
                    tabindex="${t=>t.selectionHeaderCellTabIndex}"
                    ?hidden="${t=>t.selectionMode==="none"}"
                    @keydown="${(t,e)=>t.handleSelectionHeaderKeydown(e.event)}"
                    @focusin="${(t,e)=>t.handleSelectionHeaderFocus(e.event)}"
                >
                    <span class="visually-hidden">${t=>t.selectionHeaderLabel}</span>
                    ${g(t=>t.selectionMode==="multiple"&&t.presentedRows.length>0,h`
                            <violet-checkbox
                                class="selection-checkbox"
                                inline
                                tabindex="${t=>t.selectAllTabIndex}"
                                aria-label="Select all rows"
                                :checked="${t=>t.allRowsSelected}"
                                :indeterminate="${t=>t.partiallySelected}"
                                @pointerdown="${(t,e)=>t.handleSelectionControlPointerDown(e.event)}"
                                @click="${(t,e)=>t.handleToggleAllCheckboxClick(e.event)}"
                            ></violet-checkbox>
                        `)}
                </th>
                ${N(t=>t.presentedColumns,h`
                        <th
                            id="${(t,e)=>e.parent.columnHeaderIdFor(t.id)}"
                            part="${t=>t.headerPartText}"
                            scope="col"
                            aria-colindex="${(t,e)=>String(e.parent.columnAriaColIndexFor(t.id))}"
                            data-column-id="${t=>t.id}"
                            data-align="${t=>t.align}"
                            aria-sort="${(t,e)=>e.parent.sortStateFor(t.id)}"
                            style="${t=>t.widthStyle}"
                            tabindex="${(t,e)=>t.sortable?null:e.parent.columnHeaderTabIndexFor(t.id)}"
                            aria-keyshortcuts="${t=>t.sortable?null:Zr}"
                            @keydown="${(t,e)=>e.parent.handleColumnHeaderKeydown(t.id,e.event)}"
                            @focusin="${(t,e)=>e.parent.handleColumnHeaderFocus(t.id,e.event)}"
                        >
                            ${g(t=>t.sortable,h`
                                    <button
                                        class="header-button"
                                        type="button"
                                        tabindex="${(t,e)=>e.parent.columnHeaderTabIndexFor(t.id)}"
                                        aria-keyshortcuts="${()=>Zr}"
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
                            ${g(t=>!t.sortable,h`
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
            ${N(t=>t.renderedRows,Zg)}
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
`,Fd=h`
    <div class="grid-shell">
        ${g(t=>t.shouldShowToolbar,h`
                <div class="toolbar" part="toolbar">
                    ${g(t=>t.showsBuiltInFilter,h`
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
                    ${g(t=>t.focusMode==="cell",h`
                          <div class="fill-actions" role="group" aria-label="Fill selection">
                              <button class="fill-action" type="button"
                                  ?disabled="${t=>!t.canFillSelection("down")}"
                                  @click="${t=>t.handleFillAction("down")}"
                              >Fill down</button>
                              <button class="fill-action" type="button"
                                  ?disabled="${t=>!t.canFillSelection("right")}"
                                  @click="${t=>t.handleFillAction("right")}"
                              >Fill right</button>
                              <span class="fill-status" role="status" aria-live="polite" aria-atomic="true"
                              >${t=>t.fillAnnouncement}</span>
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
            ${g(t=>t.presentedRows.length>0,h`
                            <div
                                class="table-scroll"
                                tabindex="${t=>t.scrollContainerTabIndex}"
                                @focus="${(t,e)=>t.handleGridFocus(e.event)}"
                                @focusin="${(t,e)=>t.handleGridFocusIn(e.event)}"
                                @scroll="${t=>t.handleGridScroll()}"
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
                                ${g(t=>t.focusMode==="cell",h`
                                        <span class="visually-hidden" id="${t=>t.activeCellLabelId}" aria-hidden="true">
                                            ${t=>t.activeCellDescription}
                                        </span>
                                        <span class="visually-hidden" id="${t=>t.activeCellDescribeId}">
                                            ${t=>t.activeCellDescribeText}
                                        </span>
                                    `)}
                                ${eb}
                            </div>
                `)}

            ${g(t=>t.presentedRows.length===0&&!t.busy,h`
                    <div class="empty-state" part="empty-state">
                        <slot name="empty">No rows available.</slot>
                    </div>
                `)}

            ${g(t=>t.busy,h`
                    <div class="loading-overlay" part="loading-state">
                        <slot name="loading">Loading rows...</slot>
                    </div>
                `)}
        </div>
    </div>
`;function Md(t,e){let i=e.target;if(i){if(t.focusMode==="cell"){if(t.editingCell)return;if(i instanceof HTMLTableCellElement&&i.classList.contains("selection-cell")){let o=i.dataset.selectionRowId;o&&t.focusedSelectionRowId!==o&&t.setFocusedSelectionRow(o);return}if(i instanceof HTMLTableCellElement&&i.dataset.rowId&&i.dataset.columnId){let o={rowId:i.dataset.rowId,columnId:i.dataset.columnId};(t.focusedSelectionRowId!==null||!t.sameEditingLocation(t.activeCell,o))&&(t.focusedSelectionRowId=null,t.setActiveCellDirect(o))}return}if(i.matches("violet-radio.selection-radio, violet-checkbox.selection-checkbox")){let o=t.selectionControlRowId(i);o&&(t.rowModeFocusRowId=o,t.rowModeFocusColumnId=null);return}if(i.matches("violet-checkbox.cell-checkbox")){let o=i.closest("td[data-row-id][data-column-id]");o?.dataset.rowId&&o.dataset.columnId&&(t.rowModeFocusRowId=o.dataset.rowId,t.rowModeFocusColumnId=o.dataset.columnId)}}}function Vd(t,e){if(t.focusMode!=="cell")return t.handleRowModeBodyKeydown(e);if(e.isComposing||e.keyCode===229)return!0;let i=e.target;if(t.isEditorElement(i))return e.key==="Enter"?(e.preventDefault(),t.commitActiveEdit()?t.focusActiveCell({preventScroll:!0}):t.refocusActiveEditor(),!1):e.key==="Tab"?(e.preventDefault(),t.commitEditingCellAndMove(e.shiftKey?-1:1),!1):e.key==="Escape"?(e.preventDefault(),t.cancelActiveEdit(),t.focusActiveCell({preventScroll:!0}),!1):!0;let o=t.customCellWidgetFromTarget(i);if(o)return t.handleCustomCellWidgetKeydown(o,e);let r=t.getScrollContainer(),n=i instanceof HTMLTableCellElement&&i.classList.contains("selection-cell"),s=i instanceof HTMLTableCellElement&&!!(i.dataset.rowId&&i.dataset.columnId);if(i&&i!==r&&!s&&!n)return!0;let a=s||n||t.shadowActiveElement===r;if(n||i===r&&t.focusedSelectionRowId)return t.handleSelectionCellKeydown(e,i,a);if(en(e)&&t.activeCell)return e.preventDefault(),!t.focusColumnResizer(t.activeCell.columnId,t.getActiveGridCellElement()??r);if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==="c")return t.scheduleNativeCopyFallback(),!0;if((e.key===" "||e.key==="Spacebar"||e.key==="Enter")&&t.activeCell){let u=t.presentedCellAt(t.activeCell);if(u?.editable&&u.editor==="checkbox")return e.preventDefault(),t.commitCheckboxCellToggle(t.activeCell,!t.booleanCellValue(u.rawValue)),!1}if((e.key==="Enter"||e.key==="F2")&&t.activeCell){if(e.key==="Enter"){let p=t.getActiveCellElement(),v=p?t.customCellWidgetsInCell(p):[];if(v.length>0)return e.preventDefault(),v[0]?.focus({preventScroll:!0}),!1}return t.presentedCellAt(t.activeCell)?.editable?(e.preventDefault(),t.startEditingCell(t.activeCell),!1):!0}let l=fe(e.key,t.element);if(l==="ArrowUp"&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&t.activeCell&&t.activeCell.rowId===t.presentedRows[0]?.id){let u=t.columnHeaderFocusTargetFor(t.activeCell.columnId);if(u)return e.preventDefault(),u.focus(),!1}if(t.selectionMode!=="none"&&!e.shiftKey&&!e.altKey&&t.activeCell){let u=t.columnIndexForId(t.activeCell.columnId);if(l==="ArrowLeft"&&!e.ctrlKey&&!e.metaKey&&u===0)return e.preventDefault(),t.setFocusedSelectionRow(t.activeCell.rowId),a&&t.focusActiveCell({preventScroll:!0}),!1}let d=t.nextCellLocationForKey(e,l);return d?(e.preventDefault(),t.setActiveCell(d,{extendRange:e.shiftKey}),a&&t.focusActiveCell({preventScroll:!0}),!1):!0}function Od(t,e){if(t.focusMode!=="cell")return!0;if(t.suppressNextGridClick)return t.suppressNextGridClick=!1,!0;let i=e.target;if(t.isEditorEvent(e)||t.isEditorElement(i)||t.isInteractiveCellWidgetEvent(e)||t.isInteractiveCellWidgetTarget(i))return!0;let o=e,r=i instanceof Element?i.closest("td.selection-cell[data-selection-row-id]"):null;if(r?.dataset.selectionRowId)return t.editingCell&&!t.commitActiveEdit()?(t.refocusActiveEditor(),!0):(t.setFocusedSelectionRow(r.dataset.selectionRowId),t.focusActiveCell({preventScroll:!0}),!0);let n=t.locationFromMouseEvent(o)??t.locationFromEvent(e)??t.locationFromTarget(i);if(!n){if(o.detail>=2&&t.activeCell){let p=t.presentedCellAt(t.activeCell);p?.editable&&p.editor!=="checkbox"&&t.startEditingCell(t.activeCell)}return!0}if(t.editingCell&&!t.sameEditingLocation(t.editingCell,n)&&!t.commitActiveEdit())return t.refocusActiveEditor(),!0;let s=t.activeCell?.rowId===n.rowId&&t.activeCell?.columnId===n.columnId,a=t.presentedCellAt(n);if(s&&a?.editable&&t.opensOnSingleActiveClick(a.editor))return t.startEditingCell(n),!0;t.handleCellPointerActivate(n.rowId,n.columnId,o.shiftKey);let l=typeof o.timeStamp=="number"?o.timeStamp:performance.now(),d=t.lastCellClickLocation?.rowId===n.rowId&&t.lastCellClickLocation?.columnId===n.columnId,u=l-t.lastCellClickTimestamp<=350;if(o.detail>=2||d&&u){let p=t.presentedCellAt(n);p?.editable&&p.editor!=="checkbox"&&t.startEditingCell(n)}return t.lastCellClickLocation=n,t.lastCellClickTimestamp=l,!0}function Ld(t,e){return!t||!e?!1:e.rowIndex>=t.rowStart&&e.rowIndex<=t.rowEnd&&e.columnIndex>=t.columnStart&&e.columnIndex<=t.columnEnd}function Pd(t,e){if(!t||!e)return"";let i=[];return e.rowIndex===t.rowStart&&i.push("top"),e.rowIndex===t.rowEnd&&i.push("bottom"),e.columnIndex===t.columnStart&&i.push("left"),e.columnIndex===t.columnEnd&&i.push("right"),i.join(" ")}function Bd(t,e,i){return!t||!i||!(i.rowIndex>=t.rowStart&&i.rowIndex<=t.rowEnd&&i.columnIndex>=t.columnStart&&i.columnIndex<=t.columnEnd)?!1:e?!(i.rowIndex>=e.rowStart&&i.rowIndex<=e.rowEnd&&i.columnIndex>=e.columnStart&&i.columnIndex<=e.columnEnd):!0}function Nd(t,e){let i=[t];return e.selected&&(i.push("selected-cell"),e.rangeEdge&&i.push("selected-range-edge")),e.fillPreview&&i.push("fill-preview-cell"),e.active&&i.push("active-cell"),e.editing&&i.push("editing-cell"),i.join(" ")}function jd(t){if(t.length<=150)return t;let e=t.slice(0,100),i=t.length-100,o=Math.max(1,Math.floor(i/50));for(let n=100;n<t.length&&e.length<150;n+=o){let s=t[n];s&&e.push(s)}let r=t[t.length-1];return r&&!e.includes(r)&&e.push(r),e}function Hd(t){return/[\t\r\n"]/.test(t)?`"${t.replace(/"/g,'""')}"`:t}function qd(t){let e=[],i=[],o="",r=0,n=!0;for(;r<t.length;){let s=t[r];if(n&&s==='"'){for(r+=1;r<t.length;){if(t[r]==='"'){if(t[r+1]==='"'){o+='"',r+=2;continue}r+=1;break}o+=t[r],r+=1}n=!1;continue}s==="	"?(i.push(o),o="",n=!0):s===`
`?(i.push(o),e.push(i),i=[],o="",n=!0):(o+=s,n=!1),r+=1}return i.push(o),e.push(i),e}function Wd(t){let{selection:e,locations:i,rows:o,columns:r,getCellText:n}=t;if(!i.length)return"";if(!e)return Hd(n(i[0]));let s=[];for(let a=e.rowStart;a<=e.rowEnd;a+=1){let l=[];for(let d=e.columnStart;d<=e.columnEnd;d+=1){let u=o[a],p=r[d];!u||!p||l.push(Hd(n({rowId:u.id,columnId:p.id})))}s.push(l.join("	"))}return s.join(`
`)}function Kd(t){let e=t.replace(/\r\n/g,`
`).replace(/\r/g,`
`);return e.endsWith(`
`)?e.slice(0,-1):e}function Ud(t){let{selection:e,rows:i,columns:o,activeCell:r}=t;if(!e)return r;let n=i[e.rowStart],s=o[e.columnStart];return!n||!s?r:{rowId:n.id,columnId:s.id}}function tn(t,e){return e.render?.(t.data)??e.value?.(t.data)??(e.id in Object(t.data)?t.data[e.id]:void 0)}function Gd(t,e){return t.editorOptions?typeof t.editorOptions=="function"?t.editorOptions(e):t.editorOptions:[]}function Yd(t){return Number.isNaN(t.getTime())?"":t.toISOString()}function Vs(t){if(t==null)return"";if(typeof t=="string")return t;if(typeof t=="number"||typeof t=="boolean"||typeof t=="bigint")return String(t);if(t instanceof Date)return Yd(t);if(typeof Node<"u"&&t instanceof Node)return t.textContent??"";if(Array.isArray(t))return t.map(e=>Vs(e)).join(", ");try{return JSON.stringify(t)}catch{return String(t)}}function on(t){return t==null?"":typeof t=="string"||typeof t=="number"||typeof t=="boolean"||typeof t=="bigint"?String(t):t instanceof Date?Yd(t):Array.isArray(t)?t.map(e=>Vs(e)).join(", "):Vs(t)}function Xd(t){return t.column.serialize?t.column.serialize(t.rawValue,t.rowData):t.column.editor==="checkbox"?t.booleanCellValue(t.rawValue)?"true":"false":on(t.rawValue)}function Qd(t){let e=t.rows??[];if(!t.sort||t.sortMode==="external")return[...e];let i=t.columns.find(a=>a.id===t.sort?.columnId);if(!i?.sortable)return[...e];let o=t.sort.direction==="ascending"?1:-1,r=t.getSortKey??((a,l)=>on(tn(a,l))),n=new Intl.Collator(void 0,{numeric:!0,sensitivity:"base"}),s=e.map(a=>({row:a,key:r(a,i)}));return s.sort((a,l)=>n.compare(a.key,l.key)*o),s.map(a=>a.row)}function Jd(t,e,i){return!e?.editable||e.editor==="checkbox"?null:{editingCell:t,editingValue:i}}function Zd(t){return{nextState:tb(),cancelledCell:t}}function tb(){return{editingCell:null,editingValue:""}}function eu(t){return typeof t?.value=="string"?t.value:""}function Os(t,e){let i=t;i&&(i.value=e)}function tu(t){if(t?.focus?.({preventScroll:!0}),t instanceof HTMLTextAreaElement){let i=t.value.length;t.setSelectionRange(i,i);return}if(t instanceof HTMLInputElement){let i=t.value.length;try{t.setSelectionRange(i,i)}catch{}}}function ib(t){let e=typeof t.composedPath=="function"?t.composedPath():[],i=[],o=new Set,r=n=>{o.has(n)||(o.add(n),i.push(n))};for(let n of e){if(n instanceof HTMLElement){r(n);continue}n instanceof Node&&n.parentElement instanceof HTMLElement&&r(n.parentElement)}return i}function Ls(t,e){for(let i of ib(t)){let o=i.closest(e);if(o instanceof HTMLElement)return o}return null}function iu(t){let e=t instanceof HTMLElement?t:t instanceof Node?t.parentElement:null;return e?e.closest("td[data-row-id][data-column-id]"):null}function ou(t){return Ls(t,"td[data-row-id][data-column-id]")}function ob(t,e,i){let o=t.find(n=>n.id===i.rowId),r=e.findIndex(n=>n.id===i.columnId);return!o||r<0?null:o.cells[r]??null}function nu(t,e){if(!e)return!1;for(let i=e.rowStart;i<=e.rowEnd;i+=1){let o=t[i];if(o){for(let r=e.columnStart;r<=e.columnEnd;r+=1)if(o.cells[r]?.editable)return!0}}return!1}function rn(t,e,i,o,r){for(let n=e;n<=i;n+=1){let s=t[n];if(!s)return!1;for(let a=o;a<=r;a+=1)if(!s.cells[a]?.editable)return!1}return!0}function su(t,e,i){let o={...i};for(let r=i.rowStart-1;r>=e.rowStart&&rn(t,r,r,o.columnStart,o.columnEnd);r-=1)o.rowStart=r;for(let r=i.rowEnd+1;r<=e.rowEnd&&rn(t,r,r,o.columnStart,o.columnEnd);r+=1)o.rowEnd=r;for(let r=i.columnStart-1;r>=e.columnStart&&rn(t,o.rowStart,o.rowEnd,r,r);r-=1)o.columnStart=r;for(let r=i.columnEnd+1;r<=e.columnEnd&&rn(t,o.rowStart,o.rowEnd,r,r);r+=1)o.columnEnd=r;return o}function au(t){let{text:e,originIndices:i,selection:o,selectedLocations:r,rows:n,columns:s,normalizeValue:a}=t,l=qd(e),d=l.length===1&&(l[0]?.length??0)===1;if(o&&d)return r.flatMap(p=>{let v=ob(n,s,p);return v?.editable?[{rowId:p.rowId,columnId:p.columnId,value:a(v,l[0]?.[0]??"")}]:[]});let u=[];for(let p=0;p<l.length;p+=1){let v=l[p]??[],k=n[i.rowIndex+p];if(!k)break;for(let S=0;S<v.length;S+=1){let R=s[i.columnIndex+S],F=k.cells[i.columnIndex+S];if(!R||!F)break;F.editable&&u.push({rowId:k.id,columnId:R.id,value:a(F,v[S]??"")})}}return u}function ru(t,e){return(t%e+e)%e}function lu(t){let{rows:e,columns:i,sourceBounds:o,targetBounds:r,normalizeValue:n}=t,s=o.rowEnd-o.rowStart+1,a=o.columnEnd-o.columnStart+1,l=[];for(let d=r.rowStart;d<=r.rowEnd;d+=1)for(let u=r.columnStart;u<=r.columnEnd;u+=1){if(d>=o.rowStart&&d<=o.rowEnd&&u>=o.columnStart&&u<=o.columnEnd)continue;let v=e[d],k=i[u],S=v?.cells[u];if(!v||!k||!S?.editable)continue;let R=o.rowStart+ru(d-o.rowStart,s),F=o.columnStart+ru(u-o.columnStart,a),_=e[R]?.cells[F];if(!_)continue;let $=_.rawValue??_.text;l.push({rowId:v.id,columnId:k.id,value:S.editor==="number"?n(S,String($??"")):$})}return l}function Ps(t){return t?.closest("tr[data-row-index]")?.querySelector("td[data-row-id]")?.getAttribute("data-row-id")??void 0}function cu(t,e){let i=t?.activeElement;if(!(i instanceof HTMLElement))return null;let o=i.matches("violet-radio.selection-radio")?"violet-radio.selection-radio":i.matches("violet-checkbox.selection-checkbox")?"violet-checkbox.selection-checkbox":null,r=o?Ps(i):void 0;return o&&r?{element:i,focusGeneration:e,rowId:r,selector:o}:null}function du(t,e,i){if(!t||!e)return;let o=t.getBoundingClientRect(),r=e.getBoundingClientRect();o.left<r.left?e.scrollLeft+=o.left-r.left:o.right>r.right&&(e.scrollLeft+=o.right-r.right),i||(o.top<r.top?e.scrollTop+=o.top-r.top:o.bottom>r.bottom&&(e.scrollTop+=o.bottom-r.bottom))}function nn(t,e){let i=e.activeElement;return!i||i===t||i===e.body}function Bs(t){return t instanceof HTMLTableCellElement&&(t.classList.contains("selection-cell")||!!(t.dataset.rowId&&t.dataset.columnId))}function uu(t,e){let i=Array.from(t?.querySelectorAll('tbody td[tabindex="0"]')??[]);if(i.length!==0){for(let o of i)o.setAttribute("tabindex","-1");setTimeout(()=>{let o=e();o&&o.setAttribute("tabindex","0")},0)}}function hu(t,e,i){return{hadGridCellFocus:e||!!t?.hadGridCellFocus,focusGeneration:t?Math.min(i,t.focusGeneration):i}}function pu(t){let{grid:e,ownerDocument:i,shadowRoot:o,pending:r,focusGeneration:n,gridCellFocusGeneration:s,activeCell:a,parkFocusOnScrollContainer:l}=t;if(!(r.hadGridCellFocus&&n===r.focusGeneration||s>r.focusGeneration&&n===s))return;let u=o?.activeElement;u?.isConnected&&(!Bs(u)||a&&u===a)||nn(e,i)&&(a?a.focus({preventScroll:!0}):l())}function sn(t){let e=t.dataset.rowId,i=t.dataset.columnId;return!e||!i?null:{rowId:e,columnId:i}}function fu(t){let{cells:e,clientX:i,clientY:o,predicate:r}=t;if(!e.length)return null;let n=null,s=Number.POSITIVE_INFINITY;for(let a of e){let l=sn(a);if(!l||r&&!r(l))continue;let d=a.getBoundingClientRect(),u=Math.min(Math.max(i,d.left),d.right),p=Math.min(Math.max(o,d.top),d.bottom),v=Math.hypot(i-u,o-p);v<s&&(s=v,n=a)}return n?sn(n):null}function mu(t,e,i){if(!i)return null;let o=t<i.left?i.left-t:t>i.right?t-i.right:0,r=e<i.top?i.top-e:e>i.bottom?e-i.bottom:0;return o===0&&r===0?null:o>=r?"horizontal":"vertical"}function vu(t,e){if(!t||!e)return null;let i=t.getBoundingClientRect(),o=e.getBoundingClientRect();return new DOMRect(Math.min(i.left,o.left),Math.min(i.top,o.top),Math.max(i.right,o.right)-Math.min(i.left,o.left),Math.max(i.bottom,o.bottom)-Math.min(i.top,o.top))}function yu(t,e,i){let o=i.find(r=>r.id===t);return e?.[t]??o?.width}function Ns(t){let e=getComputedStyle(t);return parseFloat(e.paddingInlineStart||"0")+parseFloat(e.paddingInlineEnd||"0")}function gu(t,e=null){if(!t)return`500 14px ${(e?getComputedStyle(e).fontFamily:"")||"sans-serif"}`;let i=getComputedStyle(t);return i.font||`${i.fontStyle} ${i.fontVariant} ${i.fontWeight} ${i.fontSize} / ${i.lineHeight} ${i.fontFamily}`}function bu(t,e,i){let r=(i??document.createElement("canvas")).getContext("2d");return r?(r.font=e,r.measureText(t).width):t.length*8}function Hs(t){if(!t)return null;if(t.endsWith("px"))return Number.parseFloat(t);let e=document.createElement("div");e.style.position="absolute",e.style.visibility="hidden",e.style.inlineSize=t,document.body.append(e);let i=e.getBoundingClientRect().width;return e.remove(),i||null}function rr(t){let e=t?Ns(t):0;return Math.max(72,Math.ceil(32+e))}function xu(t){let{headerCell:e,resolvedWidth:i}=t,o=e?.getBoundingClientRect().width;return o&&o>0?o:Hs(i)??rr(e)}function wu(t){let{columnId:e,column:i,headerCell:o,sampleCell:r,getCellText:n,sampleRows:s,measurementCanvas:a,fontSource:l=null}=t;if(!i)return rr(o);let d=gu(o,l),u=gu(r,l),p=o?Ns(o):0,v=r?Ns(r):p,k=i.sortable?24:0,S=14,R=0;for(let $ of s){let D=bu(n({rowId:$.id,columnId:e}),u,a);D>R&&(R=D)}let F=bu(i.label,d,a),_=Math.ceil(Math.max(F+p+k+S,R+v));return Math.max(rr(o),_)}function _u(t,e,i){if(i.key==="Escape")return i.preventDefault(),i.stopPropagation(),t.returnFocusFromColumnResizer(e),!1;if(i.key==="Tab")return t.returnFocusFromColumnResizer(e),!0;if(i.altKey||i.ctrlKey||i.metaKey)return!0;if(i.key==="Enter")return t.handleColumnResizeDoubleClick(e,i),!1;let o=t.resolvedColumnWidth(e)?.trim(),r=o&&/^\d+(\.\d+)?(px|rem)$/.test(o)?Hs(o):null,n=Id({key:i.key,shiftKey:i.shiftKey,currentWidth:r??t.renderedColumnWidth(e),minimumWidth:t.minimumColumnWidth(e),rtl:getComputedStyle(t.element).direction==="rtl"});return n===null?!0:(i.preventDefault(),i.stopPropagation(),t.applyLiveColumnWidth(e,`${n}px`),t.commitColumnWidth(e,`${n}px`),!1)}function ku(t,e){let i=t.selectionHeaderFocusTarget();if(!i||e.target!==i||e.altKey||e.ctrlKey||e.metaKey)return!0;if(e.key==="Tab")return t.focusMode!=="cell"?!0:e.shiftKey?(e.preventDefault(),t.focusActiveCell({preventScroll:!0}),!1):(t.temporarilySuspendRovingCellTabStop(),!0);if(e.shiftKey)return!0;switch(fe(e.key,t.element)){case"ArrowRight":{e.preventDefault();let o=t.presentedColumns[0]?.id;return o&&t.columnHeaderFocusTargetFor(o)?.focus(),!1}case"ArrowLeft":case"Home":return e.preventDefault(),!1;case"End":{e.preventDefault();let o=t.presentedColumns.at(-1)?.id;return o&&t.columnHeaderFocusTargetFor(o)?.focus(),!1}case"ArrowDown":{let o=t.presentedRows[0]?.id;return t.focusMode!=="cell"||!o?!0:(e.preventDefault(),t.setFocusedSelectionRow(o),t.focusActiveCell({preventScroll:!0}),!1)}default:return!0}}function Cu(t,e,i){let o=t.columnHeaderFocusTargetFor(e);if(!o||i.target!==o)return!0;if(en(i))return i.preventDefault(),!t.focusColumnResizer(e,o);if(i.altKey||i.ctrlKey||i.metaKey)return!0;if(i.key==="Tab")return t.focusMode!=="cell"?!0:i.shiftKey?(i.preventDefault(),t.focusActiveCell({preventScroll:!0}),!1):(t.temporarilySuspendRovingCellTabStop(),!0);if(i.shiftKey)return!0;let r=t.presentedColumns,n=r.findIndex(a=>a.id===e),s;switch(fe(i.key,t.element)){case"ArrowLeft":if(n===0){let a=t.selectionHeaderFocusTarget();if(a)return i.preventDefault(),a.focus(),!1}s=r[Math.max(0,n-1)]?.id;break;case"ArrowRight":s=r[Math.min(r.length-1,n+1)]?.id;break;case"Home":{let a=t.selectionHeaderFocusTarget();if(a)return i.preventDefault(),a.focus(),!1;s=r[0]?.id;break}case"End":s=r.at(-1)?.id;break;case"ArrowDown":return t.focusFirstRowFromHeader(e,i);default:return!0}return i.preventDefault(),s&&t.columnHeaderFocusTargetFor(s)?.focus(),!1}function nr(t,e){let i=t[0]?.id,o=e[0]?.id;return!i||!o?null:{rowId:i,columnId:o}}function Su(t,e){return t.rowId===e.rowId&&t.columnId===e.columnId?null:{anchor:t,focus:e}}function zu(t){let e=nr(t.rows,t.columns),i=t.activeCell??e;if(!i||!t.rows.length||!t.columns.length)return null;let o=t.rows.findIndex(d=>d.id===i.rowId),r=t.columns.findIndex(d=>d.id===i.columnId);if(o<0||r<0)return e;let n=t.rows.length-1,s=t.columns.length-1,a=o,l=r;switch(t.key){case"ArrowUp":a=Math.max(0,o-1);break;case"ArrowDown":a=Math.min(n,o+1);break;case"ArrowLeft":l=Math.max(0,r-1);break;case"ArrowRight":l=Math.min(s,r+1);break;case"Home":t.metaKey&&(a=0),l=0;break;case"End":t.metaKey&&(a=n),l=s;break;default:return null}return{rowId:t.rows[a]?.id??i.rowId,columnId:t.columns[l]?.id??i.columnId}}function Eu(t,e){return{anchor:e,pointerId:t,moved:!1}}function an(t,e){return t.pointerId!==null&&t.anchor!==null&&t.pointerId===e}function Tu(t){return{...t,moved:!0}}function js(){return{anchor:null,pointerId:null,moved:!1}}function $u(t,e){return e&&t.moved}function Iu(t,e){return e?{pointerId:t,sourceRange:e}:null}function ln(t,e){return t.pointerId!==null&&t.pointerId===e}function qs(){return{pointerId:null,sourceRange:null}}function no(t,e){if(typeof e!="string")return;let i=e.trim();if(!(!i||/[;{}\\]|\/\*|url\s*\(|expression\s*\(/i.test(i))&&!(typeof CSS<"u"&&typeof CSS.supports=="function"&&!CSS.supports(t,i)))return i}function Au(t){let{focusMode:e,rows:i,columns:o,activeCell:r}=t;if(e!=="cell"||!i.length||!o.length||!r)return null;let n=i.some(a=>a.id===r.rowId),s=o.some(a=>a.id===r.columnId);return!n||!s?nr(i,o):r}function Ru(t){let{focusMode:e,activeCell:i,cellSelection:o,isValidLocation:r}=t;return e!=="cell"?null:!i||!o?o:!r(o.anchor)||!r(o.focus)?null:o}function Du(t){let{focusMode:e,fillPreview:i,isValidLocation:o}=t;return e!=="cell"||!i||!o(i.anchor)||!o(i.focus)?null:i}function Fu(t){let{focusMode:e,editingCell:i,editingValue:o,isEditableLocation:r}=t;return e!=="cell"?{editingCell:null,editingValue:""}:i?r(i)?{editingCell:i,editingValue:o}:{editingCell:null,editingValue:""}:{editingCell:i,editingValue:o}}function Mu(t,e){let i=no("width",e.resolvedWidth)??"var(--violet-data-grid-default-column-width, 12rem)";return{id:t.id,label:t.label,sortable:t.sortable??!1,width:i,widthStyle:`width:${i};inline-size:${i};min-inline-size:${i};max-inline-size:${i};`,align:t.align??"start",headerPart:t.headerPart,headerPartText:e.mergePartNames("header-cell",t.headerPart),cellPart:t.cellPart,cellPartText:e.mergePartNames("cell",t.cellPart),source:t}}function Vu(t,e,i){let o=t.label?.trim()||t.id;return{id:t.id,label:o,data:t.data,cells:e.map(r=>{let n=i.cellValueFor(t,r);return{rowId:t.id,rowLabel:o,columnId:r.id,columnLabel:r.label,rowData:t.data,align:r.align,rawValue:n,text:i.serializeCellValue(r.source,t.data,n),widthStyle:r.widthStyle,cellId:i.cellIdFor(t.id,r.id),active:!1,selected:!1,rangeEdge:"",editable:r.source.editable??!1,editor:r.source.editor??"text",editing:!1,editValue:"",editingError:"",editingErrorId:i.editingErrorIdFor(t.id,r.id),fillPreview:!1,cellPart:r.cellPart,cellPartText:r.cellPartText,resolvedCellPartText:r.cellPartText,cellTemplate:r.source.cellTemplate,editorTemplate:r.source.editorTemplate,editorOptions:i.editorOptionsForColumn(r.source,t.data),parse:r.source.parse}})}}var cn=["a[href]","area[href]","button",'input:not([type="hidden"])',"select","textarea","summary","audio[controls]","video[controls]",'[contenteditable]:not([contenteditable="false"])',"[data-cell-widget]"].join(","),rb=["a[href]","area[href]","button",'input:not([type="hidden"])',"select","textarea","label","summary","audio[controls]","video[controls]",'[contenteditable]:not([contenteditable="false"])'].join(",");function Ou(t){return t instanceof Element?t:t instanceof Node?t.parentElement:null}function Lu(t){return t instanceof HTMLElement&&t.classList.contains("cell-editor")}function nb(t){let e=Ou(t);return e!==null&&e.closest(rb)!==null}function Ws(t){let e=Ou(t);return e?e.closest("[data-cell-widget]")!==null||nb(e):!1}function Pu(t){return t instanceof HTMLElement&&t.closest('[data-fill-handle="true"]')!==null}function Bu(t,e,i,o){let r=(i instanceof HTMLTableCellElement?i.dataset.selectionRowId:void 0)??t.focusedSelectionRowId??t.presentedRows[0]?.id;if(!r)return!0;let n=t.rowIndexForId(r);if(n===void 0)return!0;if(e.key===" "||e.key==="Spacebar")return e.preventDefault(),t.toggleRowSelectionFromKeyboard(r),!1;if(e.altKey||e.shiftKey)return!0;let s=t.presentedRows.length-1,a=t.presentedColumns[0]?.id,l=t.presentedColumns.at(-1)?.id;switch(fe(e.key,t.element)){case"ArrowUp":{if(e.ctrlKey||e.metaKey)return!0;if(e.preventDefault(),n===0)return(t.selectionHeaderFocusTarget()??(a?t.columnHeaderFocusTargetFor(a):null))?.focus(),!1;let u=t.presentedRows[n-1]?.id;return u&&(t.setFocusedSelectionRow(u),o&&t.focusActiveCell({preventScroll:!0})),!1}case"ArrowDown":{if(e.ctrlKey||e.metaKey)return!0;e.preventDefault();let u=t.presentedRows[Math.min(s,n+1)]?.id;return u&&(t.setFocusedSelectionRow(u),o&&t.focusActiveCell({preventScroll:!0})),!1}case"ArrowRight":return e.ctrlKey||e.metaKey||!a?!0:(e.preventDefault(),t.setActiveCell({rowId:r,columnId:a}),o&&t.focusActiveCell({preventScroll:!0}),!1);case"ArrowLeft":return e.ctrlKey||e.metaKey?!0:(e.preventDefault(),!1);case"Home":{e.preventDefault();let u=e.ctrlKey||e.metaKey?t.presentedRows[0]?.id??r:r;return t.setFocusedSelectionRow(u),o&&t.focusActiveCell({preventScroll:!0}),!1}case"End":{if(!l)return!0;e.preventDefault();let u=e.ctrlKey||e.metaKey?t.presentedRows[s]?.id??r:r;return t.setActiveCell({rowId:u,columnId:l}),o&&t.focusActiveCell({preventScroll:!0}),!1}default:return!0}}function Nu(t,e){if(e.altKey||e.shiftKey)return!0;let i=e.target;if(!i)return!0;let o=i.matches("violet-radio.selection-radio, violet-checkbox.selection-checkbox")&&i.closest("tbody")!==null,r=i.matches("violet-checkbox.cell-checkbox");if(!o&&!r)return!0;let n=t.rowModeInteractiveColumns();if(n.length===0||t.presentedRows.length===0)return!0;let s=o?t.selectionControlRowId(i):i.closest("td[data-row-id][data-column-id]")?.dataset.rowId,a=o?null:i.closest("td[data-row-id][data-column-id]")?.dataset.columnId??null;if(!s)return!0;let l=t.rowIndexForId(s),d=n.indexOf(a);if(l===void 0||d<0)return!0;let u=t.presentedRows.length-1,p=n.length-1,v=l,k=d;switch(fe(e.key,t.element)){case"ArrowUp":if(e.ctrlKey||e.metaKey)return!0;v=Math.max(0,l-1);break;case"ArrowDown":if(e.ctrlKey||e.metaKey)return!0;v=Math.min(u,l+1);break;case"ArrowLeft":if(e.ctrlKey||e.metaKey)return!0;k=Math.max(0,d-1);break;case"ArrowRight":if(e.ctrlKey||e.metaKey)return!0;k=Math.min(p,d+1);break;case"Home":(e.ctrlKey||e.metaKey)&&(v=0),k=0;break;case"End":(e.ctrlKey||e.metaKey)&&(v=u),k=p;break;default:return!0}let S=t.presentedRows[v]?.id,R=n[k];return!S||R===void 0?!0:(e.preventDefault(),t.setRowModeFocusTarget(S,R,v),!1)}function Hu(t,e,i,o={}){let r=o.preventScroll??!0,n=CSS.escape(e);if(i===null){let d=t?.querySelector(`td.selection-cell[data-selection-row-id="${n}"]`)?.querySelector("violet-radio.selection-radio, violet-checkbox.selection-checkbox");return d?(d.focus({preventScroll:r}),!0):!1}let s=CSS.escape(i),a=t?.querySelector(`td[data-row-id="${n}"][data-column-id="${s}"] violet-checkbox.cell-checkbox`);return a?(a.focus({preventScroll:r}),!0):!1}function Ks(t){return Array.from(t.querySelectorAll(cn)).filter(e=>!e.classList.contains("cell-editor")&&!e.classList.contains("cell-checkbox")&&!e.disabled&&e.getAttribute("aria-disabled")!=="true")}function ju(t){if(!t)return null;let e=t.closest("td[data-row-id][data-column-id]");if(!e)return null;let i=t.closest(cn);return!i||!e.contains(i)||i.classList.contains("cell-editor")||i.classList.contains("cell-checkbox")?null:i}function qu(t,e,i){let o=e.closest("td[data-row-id][data-column-id]");if(i.key==="Escape")return i.preventDefault(),o?.dataset.rowId&&o.dataset.columnId&&t.setActiveCell({rowId:o.dataset.rowId,columnId:o.dataset.columnId}),t.focusActiveCell({preventScroll:!0}),!1;if(i.key==="Tab"&&!i.altKey&&!i.ctrlKey&&!i.metaKey){let r=o?Ks(o):[],n=r.indexOf(e);return i.shiftKey?n>0?(i.preventDefault(),r[n-1]?.focus({preventScroll:!0}),!1):(t.temporarilySuspendRovingCellTabStop(),!0):n>=0&&n<r.length-1?(i.preventDefault(),r[n+1]?.focus({preventScroll:!0}),!1):(t.temporarilySuspendRovingCellTabStop(),!0)}return!0}function Wu(t,e,i){let o=t?.querySelectorAll("tbody td[data-row-id][data-column-id]");if(o)for(let r of o){let n=r.querySelectorAll(cn);for(let s of n)if(!(s.classList.contains("cell-editor")||s.classList.contains("cell-checkbox"))){if(e==="cell")i.has(s)||i.set(s,s.getAttribute("tabindex")),s.getAttribute("tabindex")!=="-1"&&s.setAttribute("tabindex","-1");else if(i.has(s)){let a=i.get(s);i.delete(s),a==null?s.removeAttribute("tabindex"):s.setAttribute("tabindex",a)}}}}function sb(t,e,i){let o=t.findIndex(n=>n.id===i.rowId),r=e.findIndex(n=>n.id===i.columnId);return o<0||r<0?null:{rowIndex:o,columnIndex:r}}function sr(t,e,i,o){let r=t[i],n=e[o];return!r||!n?null:{rowId:r.id,columnId:n.id}}function Ku(t,e,i){let o=sr(t,e,i.rowStart,i.columnStart),r=sr(t,e,i.rowEnd,i.columnEnd);return o&&r?{anchor:o,focus:r}:null}function Uu(t,e,i,o){if(!i)return o?[o]:[];let r=[];for(let n=i.rowStart;n<=i.rowEnd;n+=1){let s=t[n];if(s)for(let a=i.columnStart;a<=i.columnEnd;a+=1){let l=e[a];l&&r.push({rowId:s.id,columnId:l.id})}}return r}function Gu(t,e,i,o){let r=sb(t,e,i);if(!r)return null;let s=r.rowIndex*e.length+r.columnIndex+o;if(s<0||s>=t.length*e.length)return null;let a=Math.floor(s/e.length),l=s%e.length;return sr(t,e,a,l)}function Yu(t){if(!t.virtualize)return{renderedRows:t.rows.map((o,r)=>({item:{key:o.id,index:r,start:r*t.estimatedRowHeight,end:(r+1)*t.estimatedRowHeight,size:t.estimatedRowHeight,lane:0},row:o})),virtualPaddingStart:0,virtualPaddingEnd:0};let e=t.virtualItems[0],i=t.virtualItems[t.virtualItems.length-1];return{renderedRows:t.virtualItems.map(o=>{let r=t.rows[o.index];return r?{item:o,row:r}:null}).filter(o=>o!==null),virtualPaddingStart:e?.start??0,virtualPaddingEnd:Math.max(0,t.totalSize-(i?.end??0))}}function Xu(t){return{count:t.rows.length,estimateSize:()=>t.estimatedRowHeight,overscan:t.overscanCount,enabled:t.virtualize&&t.rows.length>0,getItemKey:e=>t.rows[e]?.id??e}}var H=class extends y{#e;#t;#o;#i;#r;#s;#n;#a;#d;#l;#c;#u;#p;#f;#h;#m;#g;#v;#b;#_;#z;#E;#$;#C;#k;#S;#y;#I;#w;#O;#L;#q;#R;#T;#P;#G;#B;#N;#Z;#W;#D;#te;#ie;#ee;#Y;#V;#A;#Q;#x;#K;#F;#X;constructor(){super(),this.instanceId=++ab,this.#o=null,this.#i=null,this.#r=null,this.#s=js(),this.#n=!1,this.#a=null,this.#d=e=>{e.pointerId===this.#a&&(this.#a=null)},this.#l=!1,this.#c=qs(),this.#u=null,this.#p=null,this.#f=0,this.#h=Fs(),this.#m=null,this.#g=null,this.#v=new Map,this.#b=new Map,this.#_=new Set,this.#z=0,this.#E=new Map,this.#$=new WeakMap,this.#C=new Map,this.#k=new Map,this.#S=0,this.#y=0,this.#I=-1,this.#w=-1,this.#O=!0,this.#L=!1,this.#q=!1,this.#R=null,this.#T=0,this.#P=0,this.#G=0,this.#B=0,this.#N=null,this.#Z=0,this.#W=!1,this.#D=null,this.#te=0,this.#ie=new WeakMap,this.#ee=!1,this.#Y=null,this.#V=null,this.#A=null,this.#Q=0,this.#x=null,this.#K=null,this.#F=null,this.#X=null,this.#J=null,this.#H=null,this.#U=new Set,this.#j=()=>{this.editingCell&&this.positionEditingOverlay()},this.#M=e=>{this.#T+=1,e.type==="focusin"&&this.isGridCellElement(this.shadowRoot?.activeElement)&&(this.#P=this.#T)},this.#e=this.attachInternals(),this.selectionMode="none",this.stickyHeader=!1,this.busy=!1,this.virtualize=!1,this.density="natural",this.focusMode="row",this.sortMode="local",this.columns=[],this.columnWidths={},this.rows=[],this.showFilter=!1,this.sort=null,this.filterState={},this.selectedRowIds=[],this.presentedColumns=[],this.presentedRows=[],this.renderedRows=[],this.activeCell=null,this.cellSelection=null,this.editingCell=null,this.editingValue="",this.editingError="",this.editAnnouncement="",this.fillPreview=null,this.fillAnnouncement="",this.#L=!0,this.estimatedRowHeight=this.rowHeightForDensity(this.density),this.#L=!1,this.overscanCount=5,this.virtualPaddingStart=0,this.virtualPaddingEnd=0,this.virtualTotalSize=0,this.hasToolbarSlotContent=!1,this.headerFocusColumnId=null,this.headerFocusSelection=!1,this.hostAriaLabel=null,this.focusedSelectionRowId=null,this.rowModeFocusRowId=null,this.rowModeFocusColumnId=null,this.rowModeMountedRowId=null,this.rovingCellMounted=!1,this.#t=new Qr({count:0,getScrollElement:()=>this.getScrollContainer(),estimateSize:()=>this.estimatedRowHeight,scrollToFn:Cd,observeElementRect:_d,observeElementOffset:kd,overscan:this.overscanCount,getItemKey:e=>this.presentedRows[e]?.id??e,enabled:!1,onChange:()=>{this.syncRenderedRows()}})}#J;#H;#U;#j;connectedCallback(){this.hostAriaLabel=this.getAttribute("aria-label"),this.refreshPresentation(),super.connectedCallback(),this.#Y??=new MutationObserver(()=>{this.hostAriaLabel=this.getAttribute("aria-label")}),this.#Y.observe(this,{attributes:!0,attributeFilter:["aria-label"]}),this.ownerDocument.addEventListener("focusin",this.#M,!0),this.ownerDocument.addEventListener("pointerdown",this.#M,!0),this.ownerDocument.addEventListener("pointerup",this.#d,!0),this.ownerDocument.addEventListener("pointercancel",this.#d,!0),window.addEventListener("resize",this.#j),this.#o??=this.#t._didMount(),this.hasToolbarSlotContent=this.querySelector('[slot="toolbar"]')!==null,this.syncHostStates(),this.scheduleVirtualizerUpdate()}disconnectedCallback(){this.cancelActiveEdit(),this.disconnectOverlayResizeObserver(),this.#Y?.disconnect(),this.#Y=null,this.ownerDocument.removeEventListener("focusin",this.#M,!0),this.ownerDocument.removeEventListener("pointerdown",this.#M,!0),this.ownerDocument.removeEventListener("pointerup",this.#d,!0),this.ownerDocument.removeEventListener("pointercancel",this.#d,!0),this.#a=null,window.removeEventListener("resize",this.#j),this.#i!==null&&(cancelAnimationFrame(this.#i),this.#i=null),this.#R!==null&&(cancelAnimationFrame(this.#R),this.#R=null),this.#G+=1,this.#B+=1,this.#Z+=1,this.#W=!1,this.#N=null,this.#V!==null&&(cancelAnimationFrame(this.#V),this.#V=null),this.#r!==null&&(cancelAnimationFrame(this.#r),this.#r=null),this.#t.measureElement(null),this.#o?.(),this.#o=null,super.disconnectedCallback()}selectionModeChanged(){if(this.selectionMode==="none"){this.focusedSelectionRowId=null,this.headerFocusSelection=!1,this.selectedRowIds=[];return}this.selectionMode!=="multiple"&&(this.headerFocusSelection=!1),this.selectionMode==="single"&&this.selectedRowIds.length>1&&(this.selectedRowIds=this.selectedRowIds.slice(0,1)),this.updateInteractionState(),this.scheduleVirtualizerUpdate()}stickyHeaderChanged(){this.syncHostStates()}busyChanged(){this.syncHostStates()}virtualizeChanged(){this.syncHostStates(),this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}focusModeChanged(){if(this.#D=null,this.focusMode!=="cell"){this.cancelActiveEdit(),this.focusedSelectionRowId=null,this.activeCell=null,this.cellSelection=null,this.fillPreview=null,M.enqueue(()=>this.syncCustomCellWidgetTabIndexes());return}this.headerFocusSelection=!1,!this.activeCell&&this.presentedRows.length>0&&this.presentedColumns.length>0&&(this.activeCell=this.firstCellLocation()),M.enqueue(()=>this.syncCustomCellWidgetTabIndexes())}sortModeChanged(){this.schedulePresentationRefresh()}columnsChanged(){this.captureActiveEditorSelection(),this.cancelEditIfSourceTargetInvalidated(),this.#F=this.#x?.id??null,this.#z+=1,this.#C.clear(),this.schedulePresentationRefresh()}columnWidthsChanged(){this.#z+=1,this.schedulePresentationRefresh()}rowsChanged(){this.rows.length===0&&(this.editAnnouncement=""),this.captureActiveEditorSelection(),this.cancelEditIfSourceTargetInvalidated(),this.#F=this.#x?.id??null,this.#E.clear(),this.#C.clear(),this.schedulePresentationRefresh()}showFilterChanged(){this.syncHostStates()}sortChanged(){this.commitActiveEdit(),this.clearRangeSelectionState(),this.schedulePresentationRefresh()}selectedRowIdsChanged(){this.#_=new Set(this.selectedRowIds??[]),this.#y+=1,this.syncRenderedRows()}activeCellChanged(){this.focusMode==="cell"&&(this.activeCell&&this.focusedSelectionRowId!==null&&(this.focusedSelectionRowId=null),this.updateInteractionState(),this.ensureActiveCellVisible(),this.$emit("active-cell-change",this.activeCell))}focusedSelectionRowIdChanged(){this.focusMode==="cell"&&(this.updateInteractionState(),this.focusedSelectionRowId&&this.ensureRovingRowVisible())}cellSelectionChanged(){this.focusMode==="cell"&&(this.updateInteractionState(),this.$emit("cell-selection-change",this.cellSelection))}editingCellChanged(){if(this.editingCell?this.sameEditingLocation(this.#x?.location,this.editingCell)||(this.#x={id:++this.#Q,location:{...this.editingCell}},this.editingError=""):(this.#x=null,this.editingError=""),this.updateInteractionState(),!this.editingCell||!this.#x){this.disconnectOverlayResizeObserver();return}this.scheduleEditorRestore(this.#x.id)}fillPreviewChanged(){this.focusMode==="cell"&&this.updateInteractionState()}estimatedRowHeightChanged(){this.#L||(this.#O=!1),this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}densityChanged(){this.#O&&(this.#L=!0,this.estimatedRowHeight=this.rowHeightForDensity(this.density),this.#L=!1),this.syncRenderedRows(),this.scheduleVirtualizerUpdate(),this.editingCell&&this.scheduleOverlayPosition()}overscanCountChanged(){this.syncRenderedRows(),this.scheduleVirtualizerUpdate()}get hasRows(){return this.presentedRows.length>0}get columnSpan(){return this.logicalColumnCount}get logicalRowCount(){return this.presentedRows.length+1}get logicalColumnCount(){return this.presentedColumns.length+(this.selectionMode==="none"?0:1)}get selectionHeaderId(){return`${this.localName}-selection-header-${this.instanceId}`}columnHeaderIdFor(e){return`${this.localName}-header-${this.instanceId}-${this.sanitizeForId(e)}`}get filterQuery(){return this.filterState.query??""}get showsBuiltInFilter(){return this.showFilter}get shouldShowToolbar(){return this.focusMode==="cell"||this.showsBuiltInFilter||this.hasToolbarSlotContent}get activeCellLabelId(){return`${this.localName}-active-cell-${this.instanceId}`}get activeCellDescribeId(){return`${this.localName}-active-cell-describe-${this.instanceId}`}get activeCellDescribeText(){if(!this.activeCell||this.focusedSelectionRowId)return"";let e=this.#v.get(this.activeCell.rowId)??-1;return this.columnAccessoryText(this.activeCell.columnId,this.presentedRows[e]?.data,"describe")}columnAriaColIndexFor(e){return(this.#b.get(e)??0)+(this.selectionMode==="none"?1:2)}isSelectionCellActive(e){return this.focusMode==="cell"&&this.selectionMode!=="none"&&this.focusedSelectionRowId===e}get hasSelectAllHeaderControl(){return this.selectionMode==="multiple"&&this.presentedRows.length>0}get selectionHeaderCellTabIndex(){return this.focusMode==="cell"&&this.selectionMode==="single"?"-1":null}get selectAllTabIndex(){return this.focusMode==="cell"?"-1":this.headerFocusSelection&&this.hasSelectAllHeaderControl?"0":"-1"}focus(e){this.#T+=1,!(this.focusMode==="cell"&&(!this.focusedSelectionRowId&&!this.activeCell&&this.presentedRows.length>0&&this.presentedColumns.length>0&&(this.activeCell=this.firstCellLocation()),this.focusActiveCell({preventScroll:e?.preventScroll??!1})))&&super.focus(e)}get scrollContainerTabIndex(){return this.focusMode!=="cell"||this.presentedRows.length===0||!this.rovingCellTarget()||this.rovingCellMounted?"-1":"0"}selectionCellTabIndexFor(e){if(this.focusMode!=="cell"||this.selectionMode==="none")return null;let i=this.rovingCellTarget();return i?.kind==="selection"&&i.rowId===e?"0":"-1"}cellTabIndexFor(e,i){if(this.focusMode!=="cell")return null;let o=this.rovingCellTarget();return o?.kind==="data"&&o.rowId===e&&o.columnId===i?"0":"-1"}cellAriaSelectedFor(e){return this.focusMode!=="cell"?null:e.selected?"true":this.cellSelection?"false":null}cellAriaDescribedByFor(e){return this.focusMode!=="cell"||!e.active?null:this.activeCellDescribeText?this.activeCellDescribeId:null}rowSelectionControlTabIndexFor(e){if(this.focusMode!=="row")return-1;let i=this.resolveRowModeBodyTarget();return i&&i.rowId===e&&i.columnId===null?0:-1}cellCheckboxTabIndexFor(e,i){if(this.focusMode!=="row")return-1;let o=this.resolveRowModeBodyTarget();return o&&o.rowId===e&&o.columnId===i?0:-1}rovingCellTarget(){if(this.focusMode!=="cell"||this.presentedRows.length===0)return null;if(this.selectionMode!=="none"&&this.focusedSelectionRowId&&this.#v.has(this.focusedSelectionRowId))return{kind:"selection",rowId:this.focusedSelectionRowId};if(this.activeCell&&this.isValidCellLocation(this.activeCell))return{kind:"data",rowId:this.activeCell.rowId,columnId:this.activeCell.columnId};let e=this.firstCellLocation();return e?{kind:"data",rowId:e.rowId,columnId:e.columnId}:null}rowModeInteractiveColumns(){let e=[];this.selectionMode!=="none"&&e.push(null);for(let i of this.presentedColumns)i.source.editor==="checkbox"&&i.source.editable&&e.push(i.id);return e}resolveRowModeBodyTarget(){if(this.focusMode!=="row"||this.presentedRows.length===0)return null;let e=this.rowModeInteractiveColumns();if(e.length===0)return null;let i=this.rowModeFocusRowId&&this.#v.has(this.rowModeFocusRowId)?this.rowModeFocusRowId:this.presentedRows[0].id,o=this.virtualize&&this.rowModeMountedRowId&&this.#v.has(this.rowModeMountedRowId)?this.rowModeMountedRowId:i,r=e.includes(this.rowModeFocusColumnId)?this.rowModeFocusColumnId:e[0];return{rowId:o,columnId:r}}get activeCellDescription(){if(!this.activeCell)return"No active cell.";let e=this.#v.get(this.activeCell.rowId)??-1,i=this.#b.get(this.activeCell.columnId)??-1,o=this.presentedColumns[i]?.label??this.activeCell.columnId,r=this.cellTextAt(this.activeCell)||"empty",n=this.columnAccessoryText(this.activeCell.columnId,this.presentedRows[e]?.data,"describe");return`Active cell row ${e+1}, column ${o}, value ${r}${n?`, ${n}`:""}.`}get rowSummary(){let e=this.presentedRows.length,i=this.selectedRowIds.filter(o=>this.#v.has(o)).length;return this.selectionMode==="none"?`${e} row${e===1?"":"s"}`:`${i} selected / ${e} row${e===1?"":"s"}`}get selectionHeaderLabel(){return this.selectionMode==="multiple"?"Select rows":this.selectionLabel?.trim()||"Selected row"}get selectionControlName(){return`${this.localName}-selection-${this.instanceId}`}get allRowsSelected(){let e=this.selectedRowIds??[];return this.hasRows&&e.length>=this.presentedRows.length&&this.presentedRows.every(i=>this.#_.has(i.id))}get partiallySelected(){if((this.selectedRowIds??[]).length===0)return!1;let i=this.presentedRows.filter(o=>this.#_.has(o.id)).length;return i>0&&i<this.presentedRows.length}sortStateFor(e){return!this.sort||this.sort.columnId!==e?"none":this.sort.direction}sortDirectionFor(e){return!this.sort||this.sort.columnId!==e?"ascending":this.sort.direction}isSortedColumn(e){return this.sort?.columnId===e}sortIconNameFor(e){return this.sortDirectionFor(e)==="descending"?"system/sort-descending":"system/sort-ascending"}isRowSelected(e){return this.#_.has(e)}selectionLabelFor(e,i){let o=i?.trim()||e,r=this.selectionLabel?.trim();return r&&this.selectionMode==="single"?`${r} ${o}`:`Select row ${o}`}handleToolbarSlotChange(e){let i=e.target;this.hasToolbarSlotContent=!!i?.assignedNodes({flatten:!0}).length}handleFilterInput(e){let i=e.currentTarget;if(this.editingCell&&!this.commitActiveEdit()){i&&(i.value=this.filterState.query??""),this.refocusActiveEditor();return}let o={...this.filterState,query:i?.value??""};this.clearRangeSelectionState(),this.filterState=o,this.$emit("filter-change",o)}handleSelectionControlPointerDown(e){e.stopPropagation()}handleSelectionControlClick(e){e.stopPropagation()}handleToggleAllCheckboxClick(e){e.stopPropagation();let i=e.currentTarget,o=!this.allRowsSelected;i&&(i.checked=o,"indeterminate"in i&&(i.indeterminate=!1)),this.updateSelection(o?this.presentedRows.map(r=>r.id):[])}handleRowCheckboxClick(e,i){i.stopPropagation();let o=i.currentTarget,r=!(o?.checked??!1);o&&(o.checked=r,"indeterminate"in o&&(o.indeterminate=!1));let n=new Set(this.selectedRowIds);r?n.add(e):n.delete(e),this.updateSelection([...n])}handleCellCheckboxClick(e,i,o){o.stopPropagation();let r={rowId:e,columnId:i};if(this.editingCell&&!this.sameEditingLocation(this.editingCell,r)&&!this.commitActiveEdit()){this.refocusActiveEditor();return}let n=this.presentedCellAt(r);if(!n?.editable||n.editor!=="checkbox")return;let s=o.currentTarget,a=!this.booleanCellValue(n.rawValue);s&&(s.checked=a,"indeterminate"in s&&(s.indeterminate=!1)),this.commitCheckboxCellToggle(r,a)}handleGridFocus(e){this.focusMode!=="cell"||this.#ee||e&&e.target!==this.getScrollContainer()||(!this.focusedSelectionRowId&&!this.activeCell&&this.presentedRows.length>0&&this.presentedColumns.length>0&&(this.activeCell=this.firstCellLocation()),this.focusActiveCell({preventScroll:!0}))}handleGridFocusIn(e){let i=this;Md({focusMode:this.focusMode,editingCell:this.editingCell,activeCell:this.activeCell,get focusedSelectionRowId(){return i.focusedSelectionRowId},set focusedSelectionRowId(o){i.focusedSelectionRowId=o},get rowModeFocusRowId(){return i.rowModeFocusRowId},set rowModeFocusRowId(o){i.rowModeFocusRowId=o},get rowModeFocusColumnId(){return i.rowModeFocusColumnId},set rowModeFocusColumnId(o){i.rowModeFocusColumnId=o},setActiveCellDirect:o=>{this.activeCell=o},setFocusedSelectionRow:o=>this.setFocusedSelectionRow(o),sameEditingLocation:(o,r)=>this.sameEditingLocation(o,r),selectionControlRowId:o=>this.selectionControlRowId(o)},e)}handleGridKeydown(e){return Vd({element:this,focusMode:this.focusMode,selectionMode:this.selectionMode,activeCell:this.activeCell,focusedSelectionRowId:this.focusedSelectionRowId,presentedRows:this.presentedRows,shadowActiveElement:this.shadowRoot?.activeElement??null,handleRowModeBodyKeydown:i=>this.handleRowModeBodyKeydown(i),isEditorElement:i=>this.isEditorElement(i),commitActiveEdit:()=>this.commitActiveEdit(),focusActiveCell:i=>this.focusActiveCell(i),refocusActiveEditor:()=>this.refocusActiveEditor(),commitEditingCellAndMove:i=>this.commitEditingCellAndMove(i),cancelActiveEdit:()=>this.cancelActiveEdit(),customCellWidgetFromTarget:i=>this.customCellWidgetFromTarget(i),handleCustomCellWidgetKeydown:(i,o)=>this.handleCustomCellWidgetKeydown(i,o),getScrollContainer:()=>this.getScrollContainer(),handleSelectionCellKeydown:(i,o,r)=>this.handleSelectionCellKeydown(i,o,r),focusColumnResizer:(i,o)=>this.focusColumnResizer(i,o),getActiveGridCellElement:()=>this.getActiveGridCellElement(),scheduleNativeCopyFallback:()=>{this.#l=!0,setTimeout(()=>{this.#l&&(this.#l=!1,this.handleCopyRequest())},0)},presentedCellAt:i=>this.presentedCellAt(i),booleanCellValue:i=>this.booleanCellValue(i),commitCheckboxCellToggle:(i,o)=>this.commitCheckboxCellToggle(i,o),getActiveCellElement:()=>this.getActiveCellElement(),customCellWidgetsInCell:i=>this.customCellWidgetsInCell(i),startEditingCell:i=>this.startEditingCell(i),columnHeaderFocusTargetFor:i=>this.columnHeaderFocusTargetFor(i),columnIndexForId:i=>this.#b.get(i)??-1,setFocusedSelectionRow:i=>this.setFocusedSelectionRow(i),nextCellLocationForKey:(i,o)=>this.nextCellLocationForKey(i,o),setActiveCell:(i,o)=>this.setActiveCell(i,o)},e)}handleGridClick(e){let i=this;return Od({focusMode:this.focusMode,get editingCell(){return i.editingCell},get activeCell(){return i.activeCell},get suppressNextGridClick(){return i.#n},set suppressNextGridClick(o){i.#n=o},get lastCellClickLocation(){return i.#p},set lastCellClickLocation(o){i.#p=o},get lastCellClickTimestamp(){return i.#f},set lastCellClickTimestamp(o){i.#f=o},isEditorEvent:o=>this.isEditorEvent(o),isEditorElement:o=>this.isEditorElement(o),isInteractiveCellWidgetEvent:o=>this.isInteractiveCellWidgetEvent(o),isInteractiveCellWidgetTarget:o=>this.isInteractiveCellWidgetTarget(o),commitActiveEdit:()=>this.commitActiveEdit(),refocusActiveEditor:()=>this.refocusActiveEditor(),setFocusedSelectionRow:o=>this.setFocusedSelectionRow(o),focusActiveCell:o=>this.focusActiveCell(o),locationFromMouseEvent:o=>this.locationFromMouseEvent(o),locationFromEvent:o=>this.locationFromEvent(o),locationFromTarget:o=>this.locationFromTarget(o),presentedCellAt:o=>this.presentedCellAt(o),startEditingCell:o=>this.startEditingCell(o),sameEditingLocation:(o,r)=>this.sameEditingLocation(o,r),opensOnSingleActiveClick:o=>this.opensOnSingleActiveClick(o),handleCellPointerActivate:(o,r,n)=>this.handleCellPointerActivate(o,r,n)},e)}handleGridDoubleClick(e){if(this.focusMode!=="cell")return!0;let i=e.target;if(!i&&!this.locationFromEvent(e)||this.isEditorEvent(e)||this.isEditorElement(i)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(i)||this.isFillHandleEvent(e)||this.isFillHandleTarget(i))return!0;let o=this.locationFromMouseEvent(e)??this.locationFromEvent(e)??this.locationFromTarget(i);if(!o){if(this.activeCell){let n=this.presentedCellAt(this.activeCell);if(n?.editable&&n.editor!=="checkbox")return e.preventDefault(),this.startEditingCell(this.activeCell),!1}return!0}return this.presentedCellAt(o)?.editor==="checkbox"?!0:(e.preventDefault(),this.handleCellPointerActivate(o.rowId,o.columnId,!1),this.startEditingCell(o),!1)}handleGridPointerDown(e){if(this.isEditorEvent(e)||this.isEditorElement(e.target))return this.#a=e.pointerId,!0;if(this.focusMode!=="cell"||e.button!==0||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(e.target))return!0;if(e.shiftKey)return this.locationFromEvent(e)??this.locationFromTarget(e.target)?(e.preventDefault(),!1):!0;if(this.isFillHandleEvent(e)||this.isFillHandleTarget(e.target))return this.beginFillDrag(e),!1;let i=this.locationFromEvent(e)??this.locationFromTarget(e.target);if(!i)return!0;let o=this.getScrollContainer();this.#s=Eu(e.pointerId,i),this.setActiveCell(i),this.focusActiveCell({preventScroll:!0});try{o?.setPointerCapture(e.pointerId)}catch{}return e.preventDefault(),!1}handleGridPointerMove(e){if(ln(this.#c,e.pointerId)){this.handleFillPointerMove(e);return}let i=this.#s;if(this.focusMode!=="cell"||!an(i,e.pointerId))return;let o=this.locationFromPointerEvent(e);if(!o)return;let r=i.anchor;if(!r)return;let n=this.cellSelection?.focus??r;n.rowId===o.rowId&&n.columnId===o.columnId||(this.#s=Tu(i),this.cellSelection=this.createCellSelection(r,o),this.updateInteractionState())}handleGridPointerUp(e){if(ln(this.#c,e.pointerId)){e.isTrusted&&(e.clientX||e.clientY)&&this.handleFillPointerMove(e),this.handleFillPointerUp();return}an(this.#s,e.pointerId)&&this.endPointerSelection(!0)}handleGridPointerCancel(e){if(ln(this.#c,e.pointerId)){this.endFillDrag(!1);return}an(this.#s,e.pointerId)&&this.endPointerSelection(!1)}handleGridInput(e){let i=e.target;!this.isEditorElement(i)||!this.editingCell||(this.editingValue=this.editorValueFromTarget(i),this.editingError&&(this.editingError="",this.updateInteractionState(),this.scheduleEditorRestore(this.#x?.id??null)))}handleGridChange(e){let i=e.target;if(this.isEditorElement(i)&&this.editingCell){this.editingValue=this.editorValueFromTarget(i),(this.presentedCellAt(this.editingCell)?.editor==="select"||i.dataset.commitOnChange==="true")&&(this.commitActiveEdit()?this.focusActiveCell({preventScroll:!0}):this.refocusActiveEditor());return}}handleGridPaste(e){if(this.focusMode!=="cell"||this.focusedSelectionRowId!==null||this.isEditorEvent(e)||this.isEditorElement(e.target)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(e.target))return!0;let i=e.clipboardData?.getData("text/plain")??"",o=this.pasteDetailForText(i);return o?(e.preventDefault(),this.$emit("cell-paste",o),!1):!0}handleGridFocusOut(e){let i=e.target;if(!this.isEditorElement(i))return;let o=this.#x?.id??null,r=e.relatedTarget;if(!(this.isTargetWithinEditingOwnership(r)||this.#a!==null&&(!r||r===this.getScrollContainer()))){if(r){this.commitActiveEdit()||this.refocusActiveEditor();return}if(o&&this.#F===o){this.captureEditorSelection(i,o),this.scheduleEditorRestore(o,!0);return}requestAnimationFrame(()=>{if(!this.editingCell||!o||this.#x?.id!==o)return;let n=this.getActiveEditorElement();if(n&&n!==i){Os(n,this.editingValue),this.restoreEditorSelection(n,o);return}if(this.#F===o&&n!==i&&this.presentedCellAt(this.#x.location)?.editable){this.captureEditorSelection(i,o),this.scheduleEditorRestore(o,!0);return}if(this.#a!==null||n?.matches?.(":focus-within")||n?.open||n?.shadowRoot?.activeElement)return;let a=this.shadowRoot?.activeElement;a&&this.isEditorElement(a)||this.commitActiveEdit()||this.refocusActiveEditor()})}}async handleCopyRequest(){if(this.focusedSelectionRowId!==null)return;let e=this.copyDetailForCurrentSelection();if(!e)return;this.$emit("cell-copy",e);let i=globalThis.navigator?.clipboard;if(!i?.writeText){this.$emit("cell-copy-error",{...e,error:new Error("Clipboard API is unavailable.")});return}try{await i.writeText(e.text)}catch(o){this.$emit("cell-copy-error",{...e,error:o})}}handleGridCopy(e){if(this.focusMode!=="cell"||this.focusedSelectionRowId!==null||this.isEditorEvent(e)||this.isEditorElement(e.target)||this.isInteractiveCellWidgetEvent(e)||this.isInteractiveCellWidgetTarget(e.target))return!0;this.#l=!1;let i=this.copyDetailForCurrentSelection();return!i||!e.clipboardData?!0:(e.clipboardData.setData("text/plain",i.text),e.preventDefault(),this.$emit("cell-copy",i),!1)}handleSortRequest(e){if(this.editingCell&&!this.commitActiveEdit()){this.refocusActiveEditor();return}let i=this.sort?.columnId===e?this.sort.direction:null,o;i===null?o={columnId:e,direction:"ascending"}:i==="ascending"?o={columnId:e,direction:"descending"}:o=null,this.sort=o,this.$emit("sort-change",o)}handleColumnResizePointerDown(e,i){let o=$d({button:i.button,pointerId:i.pointerId,columnId:e,clientX:i.clientX,startWidth:this.renderedColumnWidth(e)});if(!o)return;i.preventDefault(),i.stopPropagation();let r=i.currentTarget;this.#h=o,this.#m=r;try{r?.setPointerCapture(i.pointerId)}catch{}}handleColumnResizePointerMove(e){let i=this.#h;if(!Jr(i,e.pointerId)||!i.columnId)return;e.preventDefault(),e.stopPropagation();let o=Ds({session:i,clientX:e.clientX,minimumWidth:this.minimumColumnWidth(i.columnId)});this.applyLiveColumnWidth(i.columnId,`${o}px`)}handleColumnResizePointerUp(e){let i=this.#h;if(!Jr(i,e.pointerId)||!i.columnId)return;e.preventDefault(),e.stopPropagation();let o=Ds({session:i,clientX:e.clientX,minimumWidth:this.minimumColumnWidth(i.columnId)});this.commitColumnWidth(i.columnId,`${o}px`),this.endColumnResize()}handleColumnResizePointerCancel(e){let i=this.#h;!Jr(i,e.pointerId)||!i.columnId||(e.preventDefault(),e.stopPropagation(),this.applyLiveColumnWidth(i.columnId,this.resolvedColumnWidth(i.columnId)),this.endColumnResize())}handleColumnResizeKeyDown(e,i){return _u({element:this,returnFocusFromColumnResizer:o=>this.returnFocusFromColumnResizer(o),handleColumnResizeDoubleClick:(o,r)=>this.handleColumnResizeDoubleClick(o,r),resolvedColumnWidth:o=>this.resolvedColumnWidth(o),renderedColumnWidth:o=>this.renderedColumnWidth(o),minimumColumnWidth:o=>this.minimumColumnWidth(o),applyLiveColumnWidth:(o,r)=>this.applyLiveColumnWidth(o,r),commitColumnWidth:(o,r)=>this.commitColumnWidth(o,r)},e,i)}columnHeaderTabIndexFor(e){if(this.focusMode==="cell"||this.headerFocusSelection&&this.hasSelectAllHeaderControl)return"-1";let i=this.presentedColumns,o=i.some(r=>r.id===this.headerFocusColumnId)?this.headerFocusColumnId:i[0]?.id;return e===o?"0":"-1"}handleSelectionHeaderFocus(e){this.hasSelectAllHeaderControl&&e.target===this.selectionHeaderFocusTarget()&&(this.headerFocusSelection=!0)}headerKeyboardHost(){return{element:this,focusMode:this.focusMode,presentedColumns:this.presentedColumns,presentedRows:this.presentedRows,selectionHeaderFocusTarget:()=>this.selectionHeaderFocusTarget(),columnHeaderFocusTargetFor:e=>this.columnHeaderFocusTargetFor(e),focusColumnResizer:(e,i)=>this.focusColumnResizer(e,i),temporarilySuspendRovingCellTabStop:()=>this.temporarilySuspendRovingCellTabStop(),focusActiveCell:e=>this.focusActiveCell(e),setFocusedSelectionRow:e=>this.setFocusedSelectionRow(e),focusFirstRowFromHeader:(e,i)=>this.focusFirstRowFromHeader(e,i)}}handleSelectionHeaderKeydown(e){return ku(this.headerKeyboardHost(),e)}handleColumnHeaderFocus(e,i){i.target===this.columnHeaderFocusTargetFor(e)&&(this.headerFocusSelection=!1,this.headerFocusColumnId=e)}handleColumnHeaderKeydown(e,i){return Cu(this.headerKeyboardHost(),e,i)}handleColumnResizeDoubleClick(e,i){i.preventDefault(),i.stopPropagation();let o=`${this.autosizedColumnWidth(e)}px`;this.applyLiveColumnWidth(e,o),this.commitColumnWidth(e,o)}columnResizerFor(e){return this.shadowRoot?.querySelector(`[data-column-resizer="${CSS.escape(e)}"]`)??null}columnHeaderFocusTargetFor(e){let i=this.shadowRoot?.querySelector(`th[data-column-id="${CSS.escape(e)}"]`);return i?i.querySelector(".header-button")??i:null}selectionHeaderFocusTarget(){return this.hasSelectAllHeaderControl?this.shadowRoot?.querySelector("th.selection-header violet-checkbox.selection-checkbox")??null:this.focusMode==="cell"&&this.selectionMode==="single"?this.shadowRoot?.querySelector("th.selection-header")??null:null}focusFirstRowFromHeader(e,i){let o=this.presentedRows[0]?.id;return this.focusMode!=="cell"||!o?!0:(i.preventDefault(),this.focusedSelectionRowId=null,this.setActiveCell({rowId:o,columnId:e}),this.focusActiveCell({preventScroll:!0}),!1)}focusColumnResizer(e,i){let o=this.columnResizerFor(e);return o?(this.#u=i,o.focus(),!0):!1}returnFocusFromColumnResizer(e){let i=this.#u;this.#u=null;let o=this.columnHeaderFocusTargetFor(e)??this.getScrollContainer();(i?.isConnected?i:o)?.focus({preventScroll:!0})}handleToggleAll(e){let o=e.currentTarget?.checked?this.presentedRows.map(r=>r.id):[];this.updateSelection(o)}handleRowSelection(e,i){if(this.selectionMode==="none")return;let r=!!i.currentTarget?.checked;if(this.selectionMode==="single"){this.updateSelection(r?[e]:[]);return}let n=new Set(this.selectedRowIds);r?n.add(e):n.delete(e),this.updateSelection([...n])}handleCellPointerActivate(e,i,o=!1){this.focusMode==="cell"&&(this.editAnnouncement="",this.fillAnnouncement="",this.focusedSelectionRowId=null,this.setActiveCell({rowId:e,columnId:i},{extendRange:o}),this.focusActiveCell({preventScroll:!0}))}updateSelection(e){let i=[...new Set(e)];this.selectedRowIds=i,this.$emit("selection-change",{selectedRowIds:i})}clearRangeSelectionState(){this.cellSelection&&(this.cellSelection=null),this.fillPreview&&(this.fillPreview=null)}commitColumnWidth(e,i){let o={...this.columnWidths??{},[e]:i};this.columnWidths=o,this.$emit("column-width-change",{columnId:e,width:i,columnWidths:o})}endColumnResize(){if(this.#m&&this.#h.pointerId!==null&&this.#m.hasPointerCapture?.(this.#h.pointerId))try{this.#m.releasePointerCapture(this.#h.pointerId)}catch{}this.#h=Fs(),this.#m=null}schedulePresentationRefresh(){this.$fastController.isConnected&&this.refreshPresentation()}refreshPresentation(){this.#S+=1;let e=this.columns??[],i=this.rows??[],o=this.selectedRowIds??[],r=e.map(d=>this.createPresentedColumn(d)),n=this.sortRows(i,r),s=new Set(n.map(d=>d.id)),a=new Map(i.map(d=>[d.id,d])),l=o.filter(d=>s.has(d));l.length!==o.length&&(this.selectedRowIds=l,this.$emit("selection-change",{selectedRowIds:l})),this.presentedColumns=r,this.#b=new Map(r.map((d,u)=>[d.id,u])),this.#v=new Map(n.map((d,u)=>[d.id,u])),this.#_=new Set(l),this.presentedRows=n.map(d=>this.createPresentedRow(d,r));for(let[d,u]of this.#E)(!s.has(d)||a.get(d)!==u.source)&&this.#E.delete(d);for(let[d,u]of this.#C)(!s.has(d)||a.get(d)!==u.source)&&this.#C.delete(d);this.syncActiveCell(),this.focusedSelectionRowId&&(this.focusMode!=="cell"||this.selectionMode==="none"||!this.#v.has(this.focusedSelectionRowId))&&(this.focusedSelectionRowId=null),this.syncCellSelection(),this.syncEditingCell(),this.syncFillPreview(),this.updateInteractionState(),this.syncRenderedRows(),this.scheduleVirtualizerUpdate(),this.syncHostStates()}createPresentedColumn(e){return Mu(e,{resolvedWidth:this.columnWidths?.[e.id]??e.width,mergePartNames:(i,o)=>this.mergePartNames(i,o)})}createPresentedRow(e,i){let o=this.#E.get(e.id);if(o?.source===e&&o.columnRevision===this.#z)return o.row;let r=e.label?.trim()||e.id,n=null,s={id:e.id,label:r,data:e.data},a=()=>(n||(n=Vu(e,i,{cellValueFor:(l,d)=>this.cellValueFor(l,d),serializeCellValue:(l,d,u)=>this.serializeCellValue(l,d,u),cellIdFor:(l,d)=>this.cellIdFor(l,d),editingErrorIdFor:(l,d)=>this.cellEditorErrorIdFor(l,d),editorOptionsForColumn:(l,d)=>this.editorOptionsForColumn(l,d)}).cells),n);return this.#$.set(s,a),Object.defineProperty(s,"cells",{configurable:!1,enumerable:!0,get:()=>{let l=a();if(this.focusMode!=="cell")return l;let d=this.#v.get(e.id);return d===void 0?l:this.withInteractionState(s,d,this.interactionSnapshot()).cells}}),this.#E.set(e.id,{source:e,columnRevision:this.#z,row:s}),s}updateInteractionState(){this.#y+=1,this.syncRenderedRows()}withInteractionState(e,i,o){if(this.focusMode!=="cell")return e;let r=this.#k.get(e.id);if(r?.source===e&&r.interactionRevision===this.#y)return r.row;let n=this.#$.get(e)?.()??e.cells,s={id:e.id,label:e.label,data:e.data,cells:n.map((a,l)=>{let d={rowIndex:i,columnIndex:l},u=Ld(o.selectionBounds,d),p=Pd(o.selectionBounds,d),v=Bd(o.fillPreviewBounds,o.fillSourceBounds,d),k=this.isActiveCell(a.rowId,a.columnId),S=this.isEditingCell(a.rowId,a.columnId),R=S&&!this.editingError?this.columnAccessoryText(a.columnId,a.rowData,"editorHint"):"";return{...a,active:k,selected:u,fillPreview:v,rangeEdge:p,editing:S,editValue:S?this.editingValue:"",editingError:S?this.editingError:"",editingHint:R,editingHintId:R?this.cellEditorHintIdFor(a.rowId,a.columnId):"",resolvedCellPartText:Nd(a.cellPartText,{selected:u,rangeEdge:p,fillPreview:v,active:k,editing:S})}})};return this.#k.set(e.id,{source:e,interactionRevision:this.#y,row:s}),s}resolvedColumnWidth(e){return yu(e,this.columnWidths,this.columns)}renderedColumnWidth(e){let i=this.headerCellElement(e);return xu({headerCell:i,resolvedWidth:this.resolvedColumnWidth(e)})}minimumColumnWidth(e){let i=this.headerCellElement(e);return rr(i)}applyLiveColumnWidth(e,i){let o=i??"",r=CSS.escape(e);this.shadowRoot?.querySelectorAll(`[data-column-id="${r}"]`).forEach(n=>{let s=n.style;s.width=o,s.inlineSize=o,s.minInlineSize=o,s.maxInlineSize=o})}headerCellElement(e){let i=CSS.escape(e);return this.shadowRoot?.querySelector(`th[data-column-id="${i}"]`)}autosizedColumnWidth(e){let i=this.#b.get(e),o=i===void 0?void 0:this.presentedColumns[i],r=this.headerCellElement(e),n=this.cellElementForLocation(this.presentedRows[0]?{rowId:this.presentedRows[0].id,columnId:e}:null);this.#g||(this.#g=document.createElement("canvas"));let s=this.#g;return wu({columnId:e,column:o??null,rows:this.presentedRows,headerCell:r,sampleCell:n,getCellText:a=>this.cellTextAt(a),sampleRows:jd(this.presentedRows),measurementCanvas:s,fontSource:this})}cellValueFor(e,i){return tn(e,i.source)}editorOptionsForColumn(e,i){return Gd(e,i)}serializeCellValue(e,i,o){return Xd({column:e,rowData:i,rawValue:o,booleanCellValue:r=>this.booleanCellValue(r)})}sortRows(e,i){return Qd({rows:e,columns:i.map(o=>o.source),sort:this.sort,sortMode:this.sortMode,getSortKey:(o,r)=>this.sortKeyFor(o,r)})}sortKeyFor(e,i){let o=this.#C.get(e.id);if(o?.source===e&&o.column===i)return o.key;let r=on(tn(e,i));return this.#C.set(e.id,{source:e,column:i,key:r}),r}syncActiveCell(){this.activeCell=Au({focusMode:this.focusMode,rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell})}syncCellSelection(){this.cellSelection=Ru({focusMode:this.focusMode,activeCell:this.activeCell,cellSelection:this.cellSelection,isValidLocation:e=>this.isValidCellLocation(e)})}syncFillPreview(){this.fillPreview=Du({focusMode:this.focusMode,fillPreview:this.fillPreview,isValidLocation:e=>this.isValidCellLocation(e)})}syncEditingCell(){let e=Fu({focusMode:this.focusMode,editingCell:this.editingCell,editingValue:this.editingValue,isEditableLocation:i=>!!this.presentedCellAt(i)?.editable});if(this.editingCell&&!e.editingCell){this.cancelActiveEdit();return}this.editingCell=e.editingCell,this.editingValue=e.editingValue,this.#x&&this.scheduleEditorRestore(this.#x.id)}firstCellLocation(){return nr(this.presentedRows,this.presentedColumns)}nextCellLocationForKey(e,i=e.key){return zu({rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell,key:i,metaKey:e.ctrlKey||e.metaKey})}setActiveCell(e,i={}){let o=i.extendRange??!1;if(this.sameEditingLocation(this.activeCell,e)||(this.editAnnouncement=""),this.focusedSelectionRowId=null,o){let r=this.cellSelection?.anchor??this.activeCell??e;this.cellSelection=this.createCellSelection(r,e)}else this.cellSelection&&(this.cellSelection=null);this.activeCell=e,this.updateInteractionState()}setFocusedSelectionRow(e){this.selectionMode==="none"||!this.#v.has(e)||(this.editAnnouncement="",this.fillAnnouncement="",this.cellSelection&&(this.cellSelection=null),this.focusedSelectionRowId=e,this.updateInteractionState())}toggleRowSelectionFromKeyboard(e){if(this.selectionMode==="none"||!this.#v.has(e))return;if(this.selectionMode==="single"){this.updateSelection([e]);return}let i=new Set(this.selectedRowIds);i.has(e)?i.delete(e):i.add(e),this.updateSelection([...i])}handleSelectionCellKeydown(e,i,o){return Bu({element:this,focusedSelectionRowId:this.focusedSelectionRowId,presentedRows:this.presentedRows,presentedColumns:this.presentedColumns,rowIndexForId:r=>this.#v.get(r),toggleRowSelectionFromKeyboard:r=>this.toggleRowSelectionFromKeyboard(r),selectionHeaderFocusTarget:()=>this.selectionHeaderFocusTarget(),columnHeaderFocusTargetFor:r=>this.columnHeaderFocusTargetFor(r),setFocusedSelectionRow:r=>this.setFocusedSelectionRow(r),setActiveCell:r=>this.setActiveCell(r),focusActiveCell:r=>this.focusActiveCell(r)},e,i,o)}handleRowModeBodyKeydown(e){return Nu({element:this,presentedRows:this.presentedRows,rowModeInteractiveColumns:()=>this.rowModeInteractiveColumns(),selectionControlRowId:i=>this.selectionControlRowId(i),rowIndexForId:i=>this.#v.get(i),setRowModeFocusTarget:(i,o,r)=>{if(this.rowModeFocusRowId=i,this.rowModeFocusColumnId=o,this.virtualize){let n=this.#T;this.#D={rowId:i,columnId:o,focusGeneration:n},this.#t.scrollToIndex(r,{align:"auto"}),this.focusRowModeBodyControl(i,o,{preventScroll:!1})&&(this.#D=null)}else this.#D=null,this.focusRowModeBodyControl(i,o,{preventScroll:!1})}},e)}focusRowModeBodyControl(e,i,o={}){return Hu(this.shadowRoot,e,i,o)}temporarilySuspendRovingCellTabStop(){uu(this.shadowRoot,()=>this.$fastController.isConnected&&this.focusMode==="cell"?this.getActiveGridCellElement():null)}customCellWidgetsInCell(e){return Ks(e)}customCellWidgetFromTarget(e){return ju(e)}handleCustomCellWidgetKeydown(e,i){return qu({setActiveCell:o=>this.setActiveCell(o),focusActiveCell:o=>this.focusActiveCell(o),temporarilySuspendRovingCellTabStop:()=>this.temporarilySuspendRovingCellTabStop()},e,i)}syncCustomCellWidgetTabIndexes(){this.$fastController.isConnected&&Wu(this.shadowRoot,this.focusMode,this.#ie)}startEditingCell(e){if(this.editingCell){if(this.sameEditingLocation(this.editingCell,e)){this.refocusActiveEditor();return}if(!this.commitActiveEdit()){this.refocusActiveEditor();return}}let i=this.presentedCellAt(e),o=Jd(e,i,i?this.editStringForCell(i):"");o&&(this.cellSelection=null,this.editAnnouncement="",this.editingError="",this.#x={id:++this.#Q,location:{...e}},this.editingValue=o.editingValue,this.editingCell=o.editingCell,this.$emit("edit-start",e))}opensOnSingleActiveClick(e){return Dd(e)}commitActiveEdit(){let e=this.currentEditingSession();if(!e||this.#K===e.id)return!1;let i=this.presentedCellAt(e.location);if(!i?.editable||i.editor==="checkbox")return this.cancelActiveEdit();let o=this.getActiveEditorElement();o&&(this.editingValue=this.editorValueFromTarget(o)),this.#K=e.id;let r=Rd(i,this.editingValue);if(this.#K=null,this.#x?.id!==e.id)return!1;if(!r.valid)return this.editingError=r.message,this.updateInteractionState(),this.scheduleEditorRestore(e.id),!1;let n={rowId:e.location.rowId,columnId:e.location.columnId,value:r.value};return this.clearEditingSession(e.id),this.$emit("cell-change",n),!0}commitEditingCell(){return this.commitActiveEdit()}commitEditingCellAndMove(e){let i=this.editingCell;if(!i)return;if(!this.commitActiveEdit()){this.refocusActiveEditor();return}let o=this.nextTabCellLocation(i,e);this.setActiveCell(o??i),this.focusActiveCell({preventScroll:!0})}cancelActiveEdit(){let e=this.currentEditingSession();if(!e)return!1;let i=Zd(e.location);return this.clearEditingSession(e.id),this.$emit("edit-cancel",i.cancelledCell),!0}fillSelection(e,i=1){let o=this.fillSelectionRanges(e,i),r=o?this.fillDetailFor(o.source,o.target):null;return r&&(this.$emit("cell-fill",r),this.cellSelection=this.createCellSelection(r.target.anchor,r.target.focus)),r}canFillSelection(e){return this.fillSelectionRanges(e,1)!==null}handleFillAction(e){let i=this.fillSelection(e);if(i){let o=this.cellIndicesFor(i.target.focus),r=o?`row ${o.rowIndex+1}, column ${this.presentedColumns[o.columnIndex]?.label??i.target.focus.columnId}`:`row ${i.target.focus.rowId}, column ${i.target.focus.columnId}`;this.fillAnnouncement=`Filled ${i.changes.length} cell${i.changes.length===1?"":"s"} ${e}. Selection ends at ${r}.`}}fillSelectionRanges(e,i){if(this.focusMode!=="cell"||this.editingCell)return null;let o=this.currentFillSourceRange(),r=this.boundsForRange(o),n=Math.floor(i);if(!o||!r||!(n>=1)||!this.hasEditableCellsInRange(o))return null;let s=this.presentedRows.length-1,a=this.presentedColumns.length-1,l=e==="down"?Math.min(s,r.rowEnd+n):e==="up"?Math.max(0,r.rowStart-n):r.rowEnd,d=e==="right"?Math.min(a,r.columnEnd+n):e==="left"?Math.max(0,r.columnStart-n):r.columnEnd,u=this.locationForIndices(l,d),p=u?this.fillPreviewRangeForLocation(u,o):null;if(!p)return null;let v=this.boundsForRange(p);return!v||v.rowStart===r.rowStart&&v.rowEnd===r.rowEnd&&v.columnStart===r.columnStart&&v.columnEnd===r.columnEnd?null:{source:o,target:p}}currentEditingSession(){return this.editingCell?this.sameEditingLocation(this.#x?.location,this.editingCell)?this.#x:(this.#x={id:++this.#Q,location:{...this.editingCell}},this.#x):null}clearEditingSession(e){this.#x?.id===e&&(this.#x=null,this.#A=null,this.#X=null,this.#F=null,this.#K=null,this.editingCell=null,this.editingValue="",this.editingError="")}sameEditingLocation(e,i){return!!(e&&i&&e.rowId===i.rowId&&e.columnId===i.columnId)}cancelEditIfSourceTargetInvalidated(){let e=this.editingCell;if(!e)return;let i=(this.rows??[]).some(r=>r.id===e.rowId),o=(this.columns??[]).find(r=>r.id===e.columnId);(!i||!o?.editable||o.editor==="checkbox")&&this.cancelActiveEdit()}handleGridScroll(){this.editingCell&&this.positionEditingOverlay()}disconnectOverlayResizeObserver(){this.#H!==null&&(cancelAnimationFrame(this.#H),this.#H=null),this.#J?.disconnect(),this.#U.clear()}scheduleOverlayPosition(){this.#H!==null&&cancelAnimationFrame(this.#H),this.#H=requestAnimationFrame(()=>{this.#H=null,this.editingCell&&this.positionEditingOverlay()})}observeOverlayGeometry(e){if(typeof ResizeObserver>"u")return;this.#J??=new ResizeObserver(()=>{this.editingCell&&this.scheduleOverlayPosition()});let i=new Set(e);for(let o of this.#U)i.has(o)||(this.#J.unobserve(o),this.#U.delete(o));for(let o of i)this.#U.has(o)||(this.#J.observe(o),this.#U.add(o))}positionEditingOverlay(){let e=this.getScrollContainer(),i=this.cellElementForLocation(this.editingCell),o=i?.querySelector(".cell-editor-error, .cell-editor-hint")??null;if(!e||!i||!o){this.disconnectOverlayResizeObserver();return}this.observeOverlayGeometry([e,i,o]);let n=e.getBoundingClientRect().top+e.clientTop,s=n+e.clientHeight,a=i.getBoundingClientRect(),l=o.getBoundingClientRect(),d=o.offsetHeight-o.clientHeight,u=Math.max(l.height,o.scrollHeight+d),p=o.dataset.placement==="above"?Math.max(0,l.bottom-a.top):Math.max(0,a.bottom-l.top),v=s-a.bottom+p,k=a.top+p-n,S=v<u&&k>v,R=S?k:v;S?o.dataset.placement="above":delete o.dataset.placement,u>R&&R>0?o.style.maxBlockSize=`${Math.floor(R)}px`:o.style.maxBlockSize=""}scheduleEditorRestore(e,i=!1,o=0){e&&(M.enqueue(()=>{this.#x?.id===e&&this.positionEditingOverlay()}),this.#V!==null&&cancelAnimationFrame(this.#V),this.#V=requestAnimationFrame(()=>{if(this.#V=null,this.#x?.id!==e)return;this.positionEditingOverlay();let r=this.getActiveEditorElement();if(!r){if(this.#F===e&&o<3){this.scheduleEditorRestore(e,i,o+1);return}this.#F===e&&this.cancelActiveEdit();return}if(r===this.#A){if((i||this.#F===e)&&r?.focus?.({preventScroll:!0}),this.#F===e&&o<3){this.scheduleEditorRestore(e,i,o+1);return}this.#F=null;return}if(Os(r,this.editingValue),this.restoreEditorSelection(r,e),this.#A=r,this.#F===e&&o<3){this.scheduleEditorRestore(e,!0,o+1);return}this.#F=null}))}captureActiveEditorSelection(){let e=this.#x?.id,i=this.getActiveEditorElement();e&&i&&this.captureEditorSelection(i,e)}captureEditorSelection(e,i){e.selectionStart===null||e.selectionStart===void 0||(this.#X={sessionId:i,start:e.selectionStart,end:e.selectionEnd??e.selectionStart,direction:e.selectionDirection??void 0})}restoreEditorSelection(e,i){if(!e)return;let o=this.#X;if(e.focus?.({preventScroll:!0}),o?.sessionId===i&&e.setSelectionRange){e.setSelectionRange(o.start,o.end,o.direction),this.#X=null;return}tu(e)}refocusActiveEditor(){this.scheduleEditorRestore(this.#x?.id??null,!0)}isTargetWithinEditingOwnership(e){let i=this.getActiveEditorElement();if(!i||!(e instanceof Node))return!1;if(i.contains(e)||i.shadowRoot?.contains(e))return!0;let r=(e instanceof HTMLElement?e:e.parentElement)?.closest("[data-cell-widget]")??null;if(!r)return!1;let n=r.closest("td[data-row-id][data-column-id]");return!!(n&&this.editingCell&&n.dataset.rowId===this.editingCell.rowId&&n.dataset.columnId===this.editingCell.columnId)}ensureActiveCellVisible(){if(!this.activeCell)return;let e=this.#v.get(this.activeCell.rowId);e!==void 0&&(this.virtualize&&this.#t.scrollToIndex(e,{align:"auto"}),requestAnimationFrame(()=>{let i=this.getActiveCellElement(),o=this.getScrollContainer();if(!i||!o)return;let r=i.getBoundingClientRect(),n=o.getBoundingClientRect();r.left<n.left?o.scrollLeft+=r.left-n.left:r.right>n.right&&(o.scrollLeft+=r.right-n.right),this.virtualize||(r.top<n.top?o.scrollTop+=r.top-n.top:r.bottom>n.bottom&&(o.scrollTop+=r.bottom-n.bottom))}))}cellTextAt(e){return this.presentedCellAt(e)?.text??""}createCellSelection(e,i){return Su(e,i)}isValidCellLocation(e){return!!(e&&this.#v.has(e.rowId)&&this.#b.has(e.columnId))}normalizedCellSelection(){return this.boundsForRange(this.cellSelection)}visualSelectionBounds(){return this.fillPreview?this.boundsForRange(this.fillPreview):this.normalizedCellSelection()}selectedCellLocations(){return Uu(this.presentedRows,this.presentedColumns,this.normalizedCellSelection(),this.activeCell)}copyTextForLocations(e){return Wd({selection:this.normalizedCellSelection(),locations:e,rows:this.presentedRows,columns:this.presentedColumns,getCellText:i=>this.cellTextAt(i)})}copyDetailForCurrentSelection(){if(this.focusedSelectionRowId!==null)return null;let e=this.selectedCellLocations();return e.length?{cells:e,text:this.copyTextForLocations(e)}:null}pasteDetailForText(e){let i=this.normalizePastedText(e);if(!i)return null;let o=this.pasteOriginLocation();if(!o)return null;let r=this.pasteChangesForText(o,i);return r.length?{origin:o,text:i,changes:r}:null}normalizePastedText(e){return Kd(e)}pasteOriginLocation(){return this.focusedSelectionRowId!==null?null:Ud({selection:this.normalizedCellSelection(),rows:this.presentedRows,columns:this.presentedColumns,activeCell:this.activeCell})}pasteChangesForText(e,i){let o=this.cellIndicesFor(e);return o?au({text:i,originIndices:o,selection:this.normalizedCellSelection(),selectedLocations:this.selectedCellLocations(),rows:this.presentedRows,columns:this.presentedColumns,normalizeValue:(r,n)=>this.normalizedEditingValue(r,n)}):[]}currentFillSourceRange(){if(this.focusedSelectionRowId!==null)return null;let e=this.normalizedCellSelection();return e?this.rangeFromBounds(e):this.activeCell?{anchor:this.activeCell,focus:this.activeCell}:null}hasEditableCellsInRange(e){return nu(this.presentedRows,this.boundsForRange(e))}shouldShowFillHandleForCell(e,i){if(this.focusMode!=="cell")return!1;let o=this.currentFillSourceRange();if(!o)return!1;let r=this.visualSelectionBounds()??this.boundsForRange(o),n=r?this.locationForIndices(r.rowEnd,r.columnEnd):null;return!n||n.rowId!==e||n.columnId!==i?!1:this.hasEditableCellsInRange(o)}currentFillSourceBounds(){return this.currentFillSourceRange()?this.boundsForRange(this.currentFillSourceRange()):null}boundsForRange(e){if(!e)return null;let i=this.cellIndicesFor(e.anchor),o=this.cellIndicesFor(e.focus);return!i||!o?null:{rowStart:Math.min(i.rowIndex,o.rowIndex),rowEnd:Math.max(i.rowIndex,o.rowIndex),columnStart:Math.min(i.columnIndex,o.columnIndex),columnEnd:Math.max(i.columnIndex,o.columnIndex)}}rangeFromBounds(e){return Ku(this.presentedRows,this.presentedColumns,e)}locationForIndices(e,i){return sr(this.presentedRows,this.presentedColumns,e,i)}beginFillDrag(e){let i=this.currentFillSourceRange();if(!i||!this.hasEditableCellsInRange(i))return;let o=Iu(e.pointerId,i);if(!o)return;let r=this.getScrollContainer();this.#c=o,this.fillPreview=null,this.focusActiveCell({preventScroll:!0});try{r?.setPointerCapture(e.pointerId)}catch{}e.preventDefault()}handleFillPointerMove(e){let i=this.#c.sourceRange;if(!i)return;let o=this.boundsForRange(i),r=this.fillTargetLocationForPoint(e.clientX,e.clientY,o);this.fillPreview=r?this.fillPreviewRangeForLocation(r,i):null}handleFillPointerUp(){let e=this.fillDetailForPreview(),i=e?.target??this.fillPreview;e&&this.$emit("cell-fill",e),this.endFillDrag(!0),i&&(this.cellSelection=this.createCellSelection(i.anchor,i.focus))}endFillDrag(e){let i=this.getScrollContainer();if(i&&this.#c.pointerId!==null&&i.hasPointerCapture?.(this.#c.pointerId))try{i.releasePointerCapture(this.#c.pointerId)}catch{}this.#n=e,this.#c=qs(),this.fillPreview=null}fillPreviewRangeForLocation(e,i){let o=this.boundsForRange(i),r=this.cellIndicesFor(e);if(!o||!r)return null;let n={rowStart:Math.min(o.rowStart,r.rowIndex),rowEnd:Math.max(o.rowEnd,r.rowIndex),columnStart:Math.min(o.columnStart,r.columnIndex),columnEnd:Math.max(o.columnEnd,r.columnIndex)},s=this.clampFillBoundsToEditableTargets(n,o);return s.rowStart===o.rowStart&&s.rowEnd===o.rowEnd&&s.columnStart===o.columnStart&&s.columnEnd===o.columnEnd?null:this.rangeFromBounds(s)}clampFillBoundsToEditableTargets(e,i){return su(this.presentedRows,e,i)}fillTargetLocationForPoint(e,i,o){let r=this.locationFromPointerEventLike(e,i);if(r&&(!o||!this.locationWithinBounds(r,o)))return r;let n=o?this.fillPreferredAxisForPoint(e,i,o):null;if(n){let s=this.nearestLocationForPoint(e,i,a=>{if(o&&this.locationWithinBounds(a,o))return!1;let l=this.cellIndicesFor(a);return!l||!o?!0:n==="horizontal"?l.rowIndex>=o.rowStart&&l.rowIndex<=o.rowEnd:l.columnIndex>=o.columnStart&&l.columnIndex<=o.columnEnd});if(s)return s}return this.nearestLocationForPoint(e,i,s=>o?!this.locationWithinBounds(s,o):!0)}fillPreferredAxisForPoint(e,i,o){return mu(e,i,this.rectForBounds(o))}rectForBounds(e){let i=this.locationForIndices(e.rowStart,e.columnStart),o=this.locationForIndices(e.rowEnd,e.columnEnd),r=this.cellElementForLocation(i),n=this.cellElementForLocation(o);return vu(r,n)}fillDetailForPreview(){let e=this.#c.sourceRange,i=this.fillPreview;return!e||!i?null:this.fillDetailFor(e,i)}fillDetailFor(e,i){let o=this.boundsForRange(e),r=this.boundsForRange(i);if(!o||!r)return null;let n=lu({rows:this.presentedRows,columns:this.presentedColumns,sourceBounds:o,targetBounds:r,normalizeValue:(s,a)=>this.normalizedEditingValue(s,a)});return n.length?{source:e,target:i,changes:n}:null}presentedCellAt(e){if(!e)return null;let i=this.#v.get(e.rowId),o=this.#b.get(e.columnId);return i===void 0||o===void 0?null:this.presentedRows[i]?.cells[o]??null}editStringForCell(e){return Ad(e.rawValue)}normalizedEditingValue(e,i){return Ms(e,i)}booleanCellValue(e){return or(e)}nextTabCellLocation(e,i){return Gu(this.presentedRows,this.presentedColumns,e,i)}cellIndicesFor(e){let i=this.#v.get(e.rowId),o=this.#b.get(e.columnId);return i===void 0||o===void 0?null:{rowIndex:i,columnIndex:o}}isEditingCell(e,i){return this.editingCell?.rowId===e&&this.editingCell?.columnId===i}isEditorElement(e){return Lu(e)}editorValueFromTarget(e){return eu(e)}isInteractiveCellWidgetTarget(e){return Ws(e)}commitCheckboxCellToggle(e,i){let o=this.presentedCellAt(e);!o?.editable||o.editor!=="checkbox"||this.$emit("cell-change",{rowId:e.rowId,columnId:e.columnId,value:this.normalizedEditingValue(o,i)})}isFillHandleTarget(e){return Pu(e)}closestFromEventPath(e,i){return Ls(e,i)}isEditorEvent(e){return this.closestFromEventPath(e,".cell-editor")!==null}isInteractiveCellWidgetEvent(e){return e.composedPath().some(i=>Ws(i))}isFillHandleEvent(e){return this.closestFromEventPath(e,'[data-fill-handle="true"]')!==null}isActiveCell(e,i){return!this.focusedSelectionRowId&&this.activeCell?.rowId===e&&this.activeCell?.columnId===i}locationFromTarget(e){let i=this.cellElementFromTarget(e);return i?this.locationFromCellElement(i):null}locationFromEvent(e){let i=ou(e);return i?this.locationFromCellElement(i):null}cellElementFromTarget(e){return iu(e)}locationFromPointerEvent(e){let i=this.locationFromPointerEventLike(e.clientX,e.clientY);if(i)return i;let o=this.locationFromTarget(e.target);return o||this.nearestLocationForPoint(e.clientX,e.clientY)}locationFromMouseEvent(e){let i=this.locationFromPointerEventLike(e.clientX,e.clientY);return i||this.nearestLocationForPoint(e.clientX,e.clientY)}locationFromPointerEventLike(e,i){let o=this.shadowRoot?.elementFromPoint(e,i);return this.locationFromTarget(o??null)}nearestLocationForPoint(e,i,o){let r=Array.from(this.shadowRoot?.querySelectorAll("td[data-row-id][data-column-id]")??[]);return fu({cells:r,clientX:e,clientY:i,predicate:o})}locationWithinBounds(e,i){let o=this.#v.get(e.rowId),r=this.#b.get(e.columnId);return o!==void 0&&r!==void 0&&o>=i.rowStart&&o<=i.rowEnd&&r>=i.columnStart&&r<=i.columnEnd}locationFromCellElement(e){return sn(e)}cellElementForLocation(e){if(!e)return null;let i=CSS.escape(e.rowId),o=CSS.escape(e.columnId);return this.shadowRoot?.querySelector(`td[data-row-id="${i}"][data-column-id="${o}"]`)}endPointerSelection(e){let i=this.getScrollContainer(),o=this.#s;if(i&&o.pointerId!==null&&i.hasPointerCapture?.(o.pointerId))try{i.releasePointerCapture(o.pointerId)}catch{}this.#n=$u(o,e),this.#s=js()}cellIdFor(e,i){return`${this.localName}-cell-${this.instanceId}-${this.sanitizeForId(e)}-${this.sanitizeForId(i)}`}cellEditorErrorIdFor(e,i){return`${this.cellIdFor(e,i)}-edit-error`}cellEditorHintIdFor(e,i){return`${this.cellIdFor(e,i)}-edit-hint`}columnAccessoryText(e,i,o){let r=this.presentedColumns[this.#b.get(e)??-1]?.source;if(!r||i===void 0)return"";let n=r[o]?.(i);return typeof n=="string"?n.trim():""}getActiveCellElement(){return this.activeCell?this.shadowRoot?.getElementById(this.cellIdFor(this.activeCell.rowId,this.activeCell.columnId)):null}selectionCellElementForRow(e){return e?this.shadowRoot?.querySelector(`td.selection-cell[data-selection-row-id="${CSS.escape(e)}"]`)??null:null}getActiveGridCellElement(){return this.focusedSelectionRowId?this.selectionCellElementForRow(this.focusedSelectionRowId):this.getActiveCellElement()}parkFocusOnScrollContainer(){let e=this.getScrollContainer();if(e){this.#ee=!0;try{e.focus({preventScroll:!0})}finally{this.#ee=!1}}}focusActiveCell(e={}){let i=e.preventScroll??!0,o=++this.#Z,r=this.getActiveGridCellElement();if(r){this.#W=!1,r.focus({preventScroll:i});let n=this.#T;return M.enqueue(()=>{if(o!==this.#Z||!this.$fastController.isConnected||this.editingCell||this.#T!==n)return;let s=this.getActiveGridCellElement(),a=this.shadowRoot?.activeElement;if(!(a?.isConnected&&(!this.isGridCellElement(a)||a===s))&&s&&a!==s){let l=this.ownerDocument.activeElement;(!l||l===this||l===this.ownerDocument.body)&&s.focus({preventScroll:i})}}),!0}return this.focusMode==="cell"&&this.rovingCellTarget()&&(this.#W=!0,this.ensureRovingRowVisible(),this.shadowRoot?.activeElement!==this.getScrollContainer()&&this.parkFocusOnScrollContainer()),!1}ensureRovingRowVisible(){if(this.focusedSelectionRowId){let e=this.#v.get(this.focusedSelectionRowId);if(e===void 0)return;this.virtualize&&this.#t.scrollToIndex(e,{align:"auto"}),requestAnimationFrame(()=>{du(this.selectionCellElementForRow(this.focusedSelectionRowId),this.getScrollContainer(),this.virtualize)});return}this.ensureActiveCellVisible()}isGridCellElement(e){return Bs(e)}getActiveEditorElement(){if(!this.editingCell)return null;let e=CSS.escape(this.editingCell.rowId),i=CSS.escape(this.editingCell.columnId);return this.shadowRoot?.querySelector(`.cell-editor[data-row-id="${e}"][data-column-id="${i}"]`)}sanitizeForId(e){return Array.from(e,i=>/[a-zA-Z0-9]/.test(i)?i:`_${i.codePointAt(0)?.toString(16)}_`).join("")}syncHostStates(){this.toggleState("busy",this.busy),this.toggleState("sticky-header",this.stickyHeader),this.toggleState("virtualize",this.virtualize),this.toggleState("empty",!(this.presentedRows?.length??0)),this.#e.ariaBusy=this.busy?"true":"false"}syncRenderedRows(){if(!Array.isArray(this.presentedRows)||!Array.isArray(this.presentedColumns))return;let e=this.focusedSelectionControl(),i=this.isGridCellElement(this.shadowRoot?.activeElement),o=this.#T,r=this.virtualize?this.#t.getVirtualItems():[],n=this.virtualize?this.#t.getTotalSize():0,s=Yu({virtualize:this.virtualize,rows:this.presentedRows,estimatedRowHeight:this.estimatedRowHeight,virtualItems:r,totalSize:n}),a=new Set(s.renderedRows.map(F=>F.item.index)),l=this.#S;if(this.recycleFocusedRowIfNeeded(a),this.#S!==l){this.syncRenderedRows();return}let d=this.interactionSnapshot();this.virtualTotalSize=n;let p=this.#I===this.#S&&this.#w===this.#y?new Map(this.renderedRows.map(F=>[F.item.index,F])):new Map,v=s.renderedRows.map(F=>{let _=this.withInteractionState(F.row,F.item.index,d),$=p.get(F.item.index);return $?.row===_?($.item=F.item,$):{item:F.item,row:_}}),k=v.length!==this.renderedRows.length||v.some((F,_)=>F!==this.renderedRows[_]);if(k&&this.renderedRows.splice(0,this.renderedRows.length,...v),this.#I=this.#S,this.#w=this.#y,this.focusMode==="cell"){let F=new Set(s.renderedRows.map(_=>_.row.id));for(let _ of this.#k.keys())F.has(_)||this.#k.delete(_)}else this.#k.clear();this.virtualPaddingStart=s.virtualPaddingStart,this.virtualPaddingEnd=s.virtualPaddingEnd;let S=this.rovingCellTarget();this.rovingCellMounted=!!(S&&v.some(F=>F.row.id===S.rowId));let R=new Set(v.map(F=>F.row.id));this.rowModeMountedRowId=this.rowModeFocusRowId&&R.has(this.rowModeFocusRowId)?this.rowModeFocusRowId:v[0]?.row.id??null,this.scheduleRenderedRowMeasurement(),this.restoreSelectionControlFocus(e),this.recheckCellFocusAfterRender(i,o,k),this.recheckRowModeFocusAfterRender(),M.enqueue(()=>this.syncCustomCellWidgetTabIndexes())}recheckRowModeFocusAfterRender(){if(!this.#D||this.focusMode!=="row")return;let i=++this.#te;M.enqueue(()=>{if(i!==this.#te||!this.$fastController.isConnected||this.focusMode!=="row")return;let o=this.#D;if(o){if(this.#T!==o.focusGeneration){this.#D=null;return}if(!nn(this,this.ownerDocument)){this.#D=null;return}this.focusRowModeBodyControl(o.rowId,o.columnId,{preventScroll:!1})&&(this.#D=null)}})}recheckCellFocusAfterRender(e,i,o){if(this.focusMode!=="cell"||!e&&!o&&!this.#W&&!this.#N)return;let r=hu(this.#N,e,i);this.#N=r;let n=++this.#B;M.enqueue(()=>{if(n===this.#B&&(this.#N=null,!(!this.$fastController.isConnected||this.editingCell))){if(this.#W){let s=this.getActiveGridCellElement();s&&(this.#W=!1,(nn(this,this.ownerDocument)||this.shadowRoot?.activeElement)&&s.focus({preventScroll:!0}));return}pu({grid:this,ownerDocument:this.ownerDocument,shadowRoot:this.shadowRoot,pending:r,focusGeneration:this.#T,gridCellFocusGeneration:this.#P,activeCell:this.getActiveGridCellElement(),parkFocusOnScrollContainer:()=>this.parkFocusOnScrollContainer()})}})}focusedSelectionControl(){return cu(this.shadowRoot,this.#T)}selectionControlRowId(e){return Ps(e)}restoreSelectionControlFocus(e){if(!e)return;let i=++this.#G;M.enqueue(()=>{if(i!==this.#G||!this.$fastController.isConnected)return;let o=this.shadowRoot?.activeElement;if(o&&o!==e.element)return;let r=this.ownerDocument.activeElement;if(!o&&r&&r!==this.ownerDocument.body&&r!==this||o===e.element&&this.selectionControlRowId(o)===e.rowId||this.#T!==e.focusGeneration)return;Array.from(this.shadowRoot?.querySelectorAll(e.selector)??[]).find(s=>this.selectionControlRowId(s)===e.rowId)?.focus({preventScroll:!0})})}#M;interactionSnapshot(){return{selectionBounds:this.visualSelectionBounds(),fillPreviewBounds:this.fillPreview?this.boundsForRange(this.fillPreview):null,fillSourceBounds:this.#c.sourceRange?this.boundsForRange(this.#c.sourceRange):this.currentFillSourceBounds()}}scheduleRenderedRowMeasurement(){!this.virtualize||!this.$fastController.isConnected||(this.#r!==null&&cancelAnimationFrame(this.#r),this.#r=requestAnimationFrame(()=>{if(this.#r=null,!this.$fastController.isConnected)return;this.#t.measureElement(null),this.shadowRoot?.querySelectorAll("tbody tr[data-index]")?.forEach(i=>{this.#t.measureElement(i)})}))}recycleFocusedRowIfNeeded(e){if(!this.virtualize||this.#q||e.size===0&&this.presentedRows.length>0)return;let i=this.editingCell?this.#v.get(this.editingCell.rowId):void 0,r=this.shadowRoot?.activeElement?.closest?.("tr[data-row-index]"),n=r?Number.parseInt(r.dataset.rowIndex??"",10):Number.NaN,s=Number.isFinite(n)&&!e.has(n);if(i!==void 0&&!e.has(i)){this.#q=!0;let l=this.editingCell,d=l?this.presentedCellAt(l):null,u=this.#x?.id;if(!this.commitEditingCell()&&u&&this.#x?.id===u){let v=d?.columnLabel??l?.columnId??"cell";this.editAnnouncement=`Unsaved invalid edit in ${v} was cancelled because its row left the visible grid.`,this.cancelActiveEdit()}this.#q=!1,s=!0}if(!s)return;this.#R!==null&&cancelAnimationFrame(this.#R);let a=this.#T;this.#R=requestAnimationFrame(()=>{if(this.#R=null,!this.$fastController.isConnected||this.editingCell||this.#T!==a)return;let l=this.ownerDocument.activeElement;if(l&&l!==this&&l!==this.ownerDocument.body)return;let d=this.getActiveGridCellElement();d?d.focus({preventScroll:!0}):this.parkFocusOnScrollContainer()})}scheduleVirtualizerUpdate(){this.$fastController.isConnected&&(this.#i!==null&&cancelAnimationFrame(this.#i),this.#i=requestAnimationFrame(()=>{this.#i=null,this.#t.setOptions({...this.#t.options,...Xu({rows:this.presentedRows,estimatedRowHeight:this.estimatedRowHeight,overscanCount:this.overscanCount,virtualize:this.virtualize})}),this.#t._willUpdate(),this.#t.measure(),this.syncRenderedRows()}))}getScrollContainer(){return this.shadowRoot?.querySelector(".table-scroll")}rowHeightForDensity(e){switch(e){case"compact":return 24;case"comfortable":return 44;default:return 32}}toggleState(e,i){if(i){this.#e.states.add(e);return}this.#e.states.delete(e)}mergePartNames(e,i){return i?`${e} ${i}`:e}},ab=0;c({attribute:"selection-mode"})(H.prototype,"selectionMode");c({attribute:"selection-label"})(H.prototype,"selectionLabel");c({attribute:"sticky-header",mode:"boolean"})(H.prototype,"stickyHeader");c({mode:"boolean"})(H.prototype,"busy");c({mode:"boolean"})(H.prototype,"virtualize");c({attribute:"show-filter",mode:"boolean"})(H.prototype,"showFilter");c(H.prototype,"density");c({attribute:"focus-mode"})(H.prototype,"focusMode");c({attribute:"sort-mode"})(H.prototype,"sortMode");f(H.prototype,"columns");f(H.prototype,"columnWidths");f(H.prototype,"rows");f(H.prototype,"sort");f(H.prototype,"filterState");f(H.prototype,"selectedRowIds");f(H.prototype,"presentedColumns");f(H.prototype,"presentedRows");f(H.prototype,"renderedRows");f(H.prototype,"activeCell");f(H.prototype,"cellSelection");f(H.prototype,"editingCell");f(H.prototype,"editingValue");f(H.prototype,"editingError");f(H.prototype,"editAnnouncement");f(H.prototype,"fillPreview");f(H.prototype,"fillAnnouncement");f(H.prototype,"estimatedRowHeight");f(H.prototype,"overscanCount");f(H.prototype,"virtualPaddingStart");f(H.prototype,"virtualPaddingEnd");f(H.prototype,"virtualTotalSize");f(H.prototype,"hasToolbarSlotContent");f(H.prototype,"headerFocusColumnId");f(H.prototype,"headerFocusSelection");f(H.prototype,"hostAriaLabel");f(H.prototype,"focusedSelectionRowId");f(H.prototype,"rowModeFocusRowId");f(H.prototype,"rowModeFocusColumnId");f(H.prototype,"rowModeMountedRowId");f(H.prototype,"rovingCellMounted");var Qu={name:"violet-data-grid",template:Fd,styles:zd,shadowOptions:{delegatesFocus:!0}};var ar=Symbol("ownedPreviewUrl");function so(t){let e=new Set,i=[];return t.forEach((o,r)=>{if(!o||typeof o!="object")return;let n=o,s=String(n.label??n.name??"").trim();if(!s)return;let a=String(n.id??s??`attachment-${r+1}`).trim()||`attachment-${r+1}`;if(e.has(a))return;let l=typeof n.previewSrc=="string"?n.previewSrc.trim():"",d=typeof n.meta=="string"?n.meta:"",u=eh(n);e.add(a),i.push({id:a,label:s,kind:n.kind==="image"?"image":"document",...l?{previewSrc:l}:{},...d?{meta:d}:{},...u&&u===l?{[ar]:u}:{}})}),i}function dn(t){if(Array.isArray(t))return so(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return so(i)}catch{}return[]}function un(t){return JSON.stringify(so(t).map(e=>{if(!hn(e))return e;let{previewSrc:i,...o}=e;return o}))}function Ju(t){return t.map(e=>{let i=e.type.startsWith("image/")?"image":"document",o=i==="image"?URL.createObjectURL(e):"";return{id:`${e.name}:${e.size}:${e.lastModified}`,label:e.name,kind:i,previewSrc:o,meta:`${e.type||"File"} \xB7 ${lb(e.size)}`,...o?{[ar]:o}:{}}})}function Us(t){return t.kind==="image"&&!!t.previewSrc}function hn(t){return eh(t)}function Zu(t){let e=t,i=e[ar];i&&(e.previewSrc===i&&delete e.previewSrc,delete e[ar])}function lb(t){return!Number.isFinite(t)||t<=0?"0 B":t<1024?`${t} B`:t<1024*1024?`${Math.round(t/1024)} KB`:`${(t/(1024*1024)).toFixed(1)} MB`}function eh(t){if(!t||typeof t!="object")return;let e=t[ar];return typeof e=="string"&&e.trim()?e:void 0}var cb=0,th=2;function pn(t){return t.kind==="image"&&!Us(t)}var db=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_text-primary);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_size-font-md:var(--violet-type-body-size,14px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

:host([disabled]){
opacity:0.7;
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.trigger{
display:inline-flex;
align-items:center;
justify-content:flex-start;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding:0;
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}

.trigger:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
border-radius:var(--_radius-md);
}

.trigger:disabled{
cursor:not-allowed;
}

.selection{
display:inline-flex;
align-items:center;
gap:0.5rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.25rem 0.5625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:0.8125rem;
font-weight:400;
line-height:1.15;
}

.selection[data-empty="true"]{
background:var(--_surface-subtle);
border-color:color-mix(in srgb,var(--_border-subtle) 85%,transparent);
color:var(--_text-secondary);
}

.preview-stack{
display:inline-flex;
align-items:center;
gap:0.25rem;
min-inline-size:0;
max-inline-size:100%;
overflow:hidden;
}

violet-image.preview-thumb{
inline-size:1.625rem;
block-size:1.625rem;
flex:0 0 auto;
}

.preview-thumb-fallback{
inline-size:1.625rem;
block-size:1.625rem;
}

.file-chip,
.overflow-chip{
display:inline-flex;
align-items:center;
gap:0.3125rem;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.625rem;
border:1px solid color-mix(in srgb,var(--_border-subtle) 80%,transparent);
border-radius:999px;
background:color-mix(in srgb,var(--_surface-subtle) 82%,white);
color:var(--_text-primary);
box-sizing:border-box;
white-space:nowrap;
}

.overflow-chip{
color:var(--_text-secondary);
}

.chip-label,
.placeholder,
.summary{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

violet-icon.file-icon{
--violet-icon-size:0.875rem;
color:var(--_text-secondary);
flex:0 0 auto;
}

.preview-thumb-fallback,
.row-thumb-fallback{
display:inline-flex;
align-items:center;
justify-content:center;
flex:0 0 auto;
border-radius:calc(var(--_radius-md) - 2px);
background:color-mix(in srgb,var(--_surface-subtle) 90%,white);
color:var(--_text-secondary);
}

violet-icon.preview-icon{
--violet-icon-size:0.9375rem;
flex:0 0 auto;
}

.caret{
inline-size:0.375rem;
block-size:0.375rem;
flex:0 0 auto;
margin-inline-start:0.0625rem;
border-inline-end:1.25px solid currentColor;
border-block-end:1.25px solid currentColor;
transform:translateY(-2.5px) rotate(45deg);
opacity:0.78;
}

.panel{
position:fixed;
inset:unset;
margin:0;
box-sizing:border-box;
z-index:var(--_layer-popover);
display:none;
gap:0.625rem;
inline-size:min(22rem,calc(100vw - 16px));
max-block-size:calc(100vh - 16px);
overflow:auto;
min-inline-size:0;
padding:0.625rem;
border:1px solid color-mix(in srgb,var(--_border-strong) 50%,transparent);
border-radius:var(--_radius-md);
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
color:var(--_text-primary);
}

.panel:popover-open{
display:grid;
}

@media (forced-colors:active){
.trigger:focus-visible,
.panel:focus-visible{
outline:2px solid Highlight;
}

.panel{
border-color:CanvasText;
}
}

.selection-summary{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
line-height:1.2;
padding-inline:0.125rem;
}

.attachment-list{
display:grid;
gap:0.5rem;
min-inline-size:0;
}

.attachment-row{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:0.625rem;
padding:0.5rem;
border:1px solid color-mix(in srgb,var(--_border-subtle) 88%,transparent);
border-radius:calc(var(--_radius-md) - 2px);
background:color-mix(in srgb,var(--_surface-subtle) 42%,var(--_surface-page));
}

.attachment-preview{
inline-size:2rem;
block-size:2rem;
display:inline-flex;
align-items:center;
justify-content:center;
flex:0 0 auto;
border-radius:calc(var(--_radius-md) - 2px);
background:color-mix(in srgb,var(--_surface-subtle) 90%,white);
overflow:hidden;
}

violet-image.row-thumb{
inline-size:2rem;
block-size:2rem;
}

.row-thumb-fallback{
inline-size:2rem;
block-size:2rem;
}

.attachment-copy{
display:grid;
gap:2px;
min-inline-size:0;
}

.attachment-label{
margin:0;
color:var(--_text-primary);
font-size:var(--_size-font-md);
line-height:1.25;
font-weight:500;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.attachment-meta{
margin:0;
color:var(--_text-muted);
font-size:var(--_size-font-sm);
line-height:1.25;
}

.remove-button{
align-self:center;
}

.add-upload{
min-inline-size:0;
}

.add-upload::part(label),
.add-upload::part(selection),
.add-upload::part(supporting-text),
.add-upload::part(error-message),
.add-upload::part(button-copy){
display:none;
}

.add-upload::part(surface){
padding:0;
border:none;
background:transparent;
box-shadow:none;
}

.add-upload::part(button-layout){
min-block-size:auto;
}

.empty{
padding:0.25rem 0.125rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
}
`,ub=h`
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
                    ${g(t=>t.attachments.length===0,h`
                            <span class="placeholder">${t=>t.placeholder||"Add attachments"}</span>
                        `)}
                    ${N(t=>t.visibleAttachments,h`
                            ${g((t,e)=>e.parent.isImageItem(t),h`
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
                            ${g(t=>pn(t),h`
                                    <span class="preview-thumb-fallback" aria-hidden="true">
                                        <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                    </span>
                                `)}
                            ${g((t,e)=>!e.parent.isImageItem(t)&&!pn(t),h`
                                    <span class="file-chip">
                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                        <span class="chip-label">${t=>t.label}</span>
                                    </span>
                                `)}
                        `)}
                    ${g(t=>t.overflowCount>0,h`
                            <span class="overflow-chip" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                ${g(t=>t.attachments.length>0,h`
                        <span class="summary">${t=>t.selectionLabel}</span>
                    `)}
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${g(t=>t.open,h`
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
                    ${g(t=>t.attachments.length>0,h`
                            <div class="attachment-list" part="attachment-list">
                                ${N(t=>t.attachments,h`
                                        <div class="attachment-row" part="attachment-row">
                                            <span class="attachment-preview">
                                                ${g((t,e)=>e.parent.isImageItem(t),h`
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
                                                ${g(t=>pn(t),h`
                                                        <span class="row-thumb-fallback" aria-hidden="true">
                                                            <violet-icon class="preview-icon" icon="system/document" decorative></violet-icon>
                                                        </span>
                                                    `)}
                                                ${g((t,e)=>!e.parent.isImageItem(t)&&!pn(t),h`
                                                        <violet-icon class="file-icon" icon="system/document" decorative></violet-icon>
                                                    `)}
                                            </span>
                                            <div class="attachment-copy">
                                                <p class="attachment-label" title="${t=>t.label}">${t=>t.label}</p>
                                                <p class="attachment-meta">${t=>t.meta||"Attachment"}</p>
                                            </div>
                                            ${g((t,e)=>!e.parent.readonly,h`
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
                    ${g(t=>t.attachments.length===0,h`
                            <div class="empty" part="empty-state">No attachments yet</div>
                        `)}
                    ${g(t=>!t.readonly,h`
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
`,Ut=class extends y{#e=++cb;#t="[]";#o=new Set;#i=!1;#r=0;#s=null;#n=[];#a=()=>this.positionPanel();#d=e=>{let i=e.relatedTarget;i&&i!==this&&!this.shadowRoot?.contains(i)&&this.close(!0)};#l=e=>{!this.open||e.composedPath().includes(this)||this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.readonly=!1,this.attachments=[],this.open=!1}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#d),this.ownerDocument.addEventListener("pointerdown",this.#l,!0)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#l,!0),this.removeEventListener("focusout",this.#d),this.close(!1),super.disconnectedCallback(),this.attachments.forEach(Zu),this.releaseAllOwnedPreviewUrls()}get value(){return un(this.attachments)}set value(e){let i=dn(e);un(i)!==this.value&&this.setAttachments(i)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Edit attachments"}get triggerLabelledBy(){return this.attachments.length===0&&this.triggerLabel===(this.placeholder||"Add attachments")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get visibleAttachments(){return this.attachments.slice(0,th)}get overflowCount(){return Math.max(0,this.attachments.length-th)}get selectionLabel(){return this.attachments.length===0?this.placeholder||"Add attachments":this.attachments.length===1?this.attachments[0]?.label??"1 attachment":`${this.attachments[0]?.label??`${this.attachments.length} attachments`} +${this.attachments.length-1}`}get selectionSummary(){return this.attachments.length===0?"No attachments":`${this.attachments.length} attachment${this.attachments.length===1?"":"s"}`}attachmentsChanged(e,i){this.#i||this.syncOwnedPreviewUrls(e??[],i??[])}handleTriggerClick(){if(this.disabled)return;if(this.open){this.close(!0),this.focusTrigger();return}this.#t=this.value,this.open=!0;let e=++this.#r;M.next().then(()=>{if(!this.open||!this.$fastController.isConnected||e!==this.#r)return;let i=this.panelElement();i&&(i.showPopover(),this.startPanelTracking(),this.positionPanel(),this.#s=requestAnimationFrame(()=>{this.#s=null,this.open&&this.$fastController.isConnected&&e===this.#r&&i.focus({preventScroll:!0})}))})}disabledChanged(){this.disabled&&this.close(!0)}handlePanelToggle(e){e.newState==="closed"&&e.currentTarget===this.panelElement()&&!this.panelElement()?.matches(":popover-open")&&this.close(!0)}handlePanelKeydown(e){e.stopPropagation(),!(e.isComposing||e.keyCode===229||e.key!=="Escape")&&(e.preventDefault(),this.close(!0),this.focusTrigger())}handleUploadChange(e){if(e.stopPropagation(),this.disabled||this.readonly)return;let i=e.detail,o=e.currentTarget,r=i?.files??[];r.length!==0&&(this.appendFiles(r),o?.clearFiles())}appendFiles(e){if(this.disabled||this.readonly||e.length===0)return;let i=Ju(e);this.appendAttachments(i),this.$emit("upload-request",{files:[...e],attachments:dn(un(i))})}appendAttachments(e){if(this.disabled||this.readonly)return;let i=so([...this.attachments,...e]);this.syncOwnedPreviewUrls([...this.attachments,...e],i),this.applyAttachments(i,"input")}removeAttachmentById(e){this.disabled||this.readonly||this.applyAttachments(this.attachments.filter(i=>i.id!==e),"input")}isImageItem(e){return Us(e)}applyAttachments(e,i){this.setAttachments(so(e)),this.$emit(i,{attachments:[...this.attachments],value:this.value})}close(e){this.#r+=1,this.stopPanelTracking();let i=this.panelElement();if(i?.matches(":popover-open")&&i.hidePopover(),!this.open)return;let o=this.value,r=o!==this.#t;this.open=!1,e&&r&&this.$emit("change",{attachments:dn(o),value:o})}focusTrigger(){this.#s=requestAnimationFrame(()=>{this.#s=null,!(this.open||this.disabled||!this.$fastController.isConnected)&&this.shadowRoot?.querySelector(".trigger")?.focus()})}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}startPanelTracking(){this.stopPanelTracking();let e=this.getRootNode();for(;e instanceof ShadowRoot;)this.#n.push(e),e=e.host.getRootNode();this.#n.push(this.ownerDocument),this.#n.forEach(i=>{i.addEventListener("scroll",this.#a,!0)}),this.ownerDocument.defaultView?.addEventListener("resize",this.#a)}stopPanelTracking(){this.#n.forEach(e=>{e.removeEventListener("scroll",this.#a,!0)}),this.#n.length=0,this.ownerDocument.defaultView?.removeEventListener("resize",this.#a),this.#s!==null&&(cancelAnimationFrame(this.#s),this.#s=null)}positionPanel(){let e=this.panelElement(),i=this.shadowRoot?.querySelector(".trigger"),o=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!o)return;let r=i.getBoundingClientRect(),n=e.getBoundingClientRect(),s=8,a=r.bottom+6,l=a+n.height<=o.innerHeight-s?a:r.top-n.height-6;e.style.left=`${Math.max(s,Math.min(r.left,o.innerWidth-n.width-s))}px`,e.style.top=`${Math.max(s,l)}px`}setAttachments(e){this.syncOwnedPreviewUrls(this.attachments,e),this.#i=!0;try{this.attachments=e}finally{this.#i=!1}}syncOwnedPreviewUrls(e,i){let o=new Set(i.map(r=>hn(r)).filter(r=>!!r));e.map(r=>hn(r)).filter(r=>!!r).forEach(r=>{o.has(r)||(URL.revokeObjectURL(r),this.#o.delete(r))}),o.forEach(r=>{this.#o.add(r)})}releaseAllOwnedPreviewUrls(){this.#o.forEach(e=>{URL.revokeObjectURL(e)}),this.#o.clear()}};c(Ut.prototype,"placeholder");c({mode:"boolean"})(Ut.prototype,"disabled");c({mode:"boolean"})(Ut.prototype,"readonly");f(Ut.prototype,"attachments");f(Ut.prototype,"open");var ih={name:"violet-data-grid-attachment-cell",template:ub,styles:db,shadowOptions:{delegatesFocus:!0}};function ao(t,e){let i=e.trim().toLowerCase();return i?t.filter(o=>[o.label,o.value,o.description??"",...o.keywords??[]].join(" ").toLowerCase().includes(i)):t}function hb(t,e){return t.find(i=>i.value===e)??null}function lo(t,e){return hb(t,e)??{label:e,value:e}}function Gs(t){let e=co(t);return`background:${e.background};color:${e.foreground};border-color:${e.borderColor};`}function co(t){if(t.background||t.foreground||t.borderColor)return{background:t.background??"var(--_surface-subtle)",foreground:t.foreground??"var(--_text-primary)",borderColor:t.borderColor??"transparent"};switch(t.tone){case"teal":return{background:"#0b7280",foreground:"#ffffff",borderColor:"transparent"};case"green":return{background:"#176c27",foreground:"#ffffff",borderColor:"transparent"};case"olive":return{background:"#547d46",foreground:"#f5fbf2",borderColor:"transparent"};case"gold":return{background:"#8b6b24",foreground:"#fff7de",borderColor:"transparent"};case"blue":return{background:"#416b89",foreground:"#ffffff",borderColor:"transparent"};case"gray":return{background:"#606672",foreground:"#f6f7fa",borderColor:"transparent"};default:return{background:"color-mix(in srgb, var(--_surface-subtle) 90%, white)",foreground:"var(--_text-primary)",borderColor:"color-mix(in srgb, var(--_border-subtle) 80%, transparent)"}}}function uo(t){let e=new Set,i=[];for(let o of t){let r=String(o??"").trim();!r||e.has(r)||(e.add(r),i.push(r))}return i}function oh(t){if(Array.isArray(t))return uo(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return uo(i)}catch{}return uo(e.split(/\s*,\s*/u))}function fn(t){return JSON.stringify(uo(t))}var pb=0,rh=2,fb=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_text-primary);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_radius-sm:var(--violet-radius-inset,4px);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_pill-font-size:var(--violet-data-grid-pill-font-size,0.8125rem);
--_size-font-md:var(--violet-type-body-size,14px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

:host([disabled]){
opacity:0.7;
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.trigger{
display:inline-flex;
align-items:center;
justify-content:flex-start;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding:0;
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}

.trigger:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
border-radius:var(--_radius-sm);
}

.trigger:disabled{
cursor:not-allowed;
}

.selection{
display:inline-flex;
align-items:center;
gap:0.25rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.25rem 0.5625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:var(--_pill-font-size);
font-weight:400;
line-height:1;
}

.selection[data-empty="true"]{
background:var(--_surface-subtle);
border-color:color-mix(in srgb,var(--_border-subtle) 85%,transparent);
color:var(--_text-secondary);
}

.pills{
display:inline-flex;
align-items:center;
gap:0.25rem;
min-inline-size:0;
max-inline-size:100%;
overflow:hidden;
}

.pill{
display:inline-flex;
align-items:center;
justify-content:center;
gap:0.25rem;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.375rem;
padding-inline:0.625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:var(--_pill-font-size);
font-weight:400;
line-height:1;
}

.pill-label,
.placeholder{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.overflow-pill{
background:color-mix(in srgb,var(--_surface-subtle) 88%,white);
border-color:color-mix(in srgb,var(--_border-subtle) 80%,transparent);
color:var(--_text-secondary);
}

.caret{
inline-size:0.375rem;
block-size:0.375rem;
flex:0 0 auto;
margin-inline-start:0.0625rem;
border-inline-end:1.25px solid currentColor;
border-block-end:1.25px solid currentColor;
transform:translateY(-2.5px) rotate(45deg);
opacity:0.78;
}

.panel{
position:fixed;
inset:unset;
margin:0;
box-sizing:border-box;
max-inline-size:calc(100vw - 16px);
max-block-size:calc(100vh - 16px);
overflow:auto;
z-index:var(--_layer-popover);
display:grid;
gap:0.5rem;
inline-size:min(18rem,max(14rem,100%));
min-inline-size:0;
padding:0.5rem;
border:1px solid color-mix(in srgb,var(--_border-strong) 50%,transparent);
border-radius:var(--_radius-md);
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
}

.search{
inline-size:100%;
min-inline-size:0;
padding:0.5rem 0.625rem;
border:1px solid var(--_field-border);
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_field-background);
color:var(--_field-text);
font:inherit;
font-size:var(--_size-font-md);
outline:none;
box-sizing:border-box;
}

.search:hover{
border-color:var(--_field-border-hover);
}

.search:focus-visible{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

.selection-summary{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
line-height:1.2;
padding-inline:0.125rem;
}

.listbox{
--violet-listbox-min-inline-size:100%;
--violet-listbox-max-block-size:12rem;
--violet-listbox-padding:0.25rem;
}

.option-swatch{
inline-size:0.625rem;
block-size:0.625rem;
border-radius:999px;
border:1px solid color-mix(in srgb,var(--_border-subtle) 75%,transparent);
box-sizing:border-box;
}

.option-check{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
font-weight:700;
line-height:1;
}

.empty{
padding:0.5rem 0.25rem 0.25rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
}
`,mb=h`
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
                    ${g(t=>t.selectedValues.length===0,h`
                            <span class="placeholder">${t=>t.placeholder||"Add options"}</span>
                        `)}
                    ${N(t=>t.visibleSelectedEntries,h`
                            <span class="pill" part="pill" style="${(t,e)=>e.parent.pillStyleForValue(t.value)}">
                                <span class="pill-label">${t=>t.label}</span>
                            </span>
                        `)}
                    ${g(t=>t.overflowCount>0,h`
                            <span class="pill overflow-pill" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${g(t=>t.open,h`
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
                                ${N(t=>t.filteredOptions,h`
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
                    ${g(t=>t.filteredOptions.length===0,h`
                            <div class="empty" part="empty-state" role="status">No matching options</div>
                        `)}
                </div>
            `)}
    </div>
`,zt=class extends y{#e=++pb;#t="[]";#o=null;#i=0;#r=null;#s=null;#n=e=>{let i=this.panelElement();i&&!e.composedPath().includes(i)&&this.positionPanel()};#a=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#d=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let o=e.composedPath();if(e.type==="pointerup"&&o.includes(i)){let n=i.options.find(s=>o.includes(s));n&&!n.isDisabled&&(i.activeValue=n.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#l=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#c=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let o=this.listboxElement();e.button===0&&o&&!this.disabled&&i.includes(o)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#a),this.addEventListener("keydown",this.#l,!0),this.ownerDocument.addEventListener("pointerdown",this.#c,!0),this.ownerDocument.addEventListener("pointerup",this.#d,!0),this.ownerDocument.addEventListener("pointercancel",this.#d,!0)}disconnectedCallback(){this.close(!1),this.removeViewportListeners(),this.#i+=1,this.removeEventListener("focusout",this.#a),this.removeEventListener("keydown",this.#l,!0),this.ownerDocument.removeEventListener("pointerdown",this.#c,!0),this.ownerDocument.removeEventListener("pointerup",this.#d,!0),this.ownerDocument.removeEventListener("pointercancel",this.#d,!0),super.disconnectedCallback()}get value(){return fn(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Select options"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Add options")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get listboxId(){return`${this.panelId}-listbox`}disabledChanged(){this.disabled&&this.open&&this.close(!0)}handlePanelToggle(e){let i=this.panelElement();e.newState==="closed"&&i&&!i.matches(":popover-open")&&this.close(!0)}filterQueryChanged(){M.next().then(()=>this.positionPanel())}get selectedEntries(){return this.selectedValues.map(e=>{let i=lo(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,rh)}get overflowCount(){return Math.max(0,this.selectedValues.length-rh)}get selectionSummary(){return this.selectedValues.length===0?"No options selected":`${this.selectedValues.length} option${this.selectedValues.length===1?"":"s"} selected`}get filteredOptions(){return ao(this.options,this.filterQuery)}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel(e.key==="ArrowUp"?"last":"listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??""}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault(),e.stopPropagation(),this.focusListboxControl(e.key==="ArrowUp");return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,o=new Set(this.filteredOptions.map(n=>n.value)),r=this.selectedValues.filter(n=>!o.has(n));this.applySelection([...r,...i?.selectedValues??[]],"input")}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}toggleValue(e){if(this.disabled)return;let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}pillStyleForValue(e){let i=this.options.find(o=>o.value===e)??null;return this.optionStyle(i)}optionSwatchStyle(e){return`background:${co(e).background};`}syncSelectionFromValue(e){let i=oh(e);i.length===this.selectedValues.length&&i.every((o,r)=>o===this.selectedValues[r])||(this.selectedValues=i)}applySelection(e,i){this.selectedValues=this.orderedSelectedValues(new Set(uo(e))),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(r=>e.has(r.value)).map(r=>r.value),o=[...e].filter(r=>!this.options.some(n=>n.value===r));return[...i,...o]}optionStyle(e){return e?Gs(e):Gs({label:"",value:""})}close(e){if(this.#s=null,!this.open)return;this.#i+=1;let i=fn(this.selectedValues),o=i!==this.#t;this.#o=null,this.open=!1;let r=this.panelElement();r?.matches(":popover-open")&&r.hidePopover(),this.removeViewportListeners(),this.filterQuery="",e&&o&&this.$emit("change",{value:i,selectedValues:[...this.selectedValues]})}openPanel(e){if(this.disabled)return;this.#i+=1,this.open||(this.#t=fn(this.selectedValues)),this.#o=e,this.open=!0;let i=this.getRootNode();this.#r=i instanceof ShadowRoot?i:null,this.#r?.addEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.addEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.addEventListener("resize",this.#n),this.queueOpenFocus()}queueOpenFocus(){let e=this.#i,i=this.#o;this.#o=null,i&&M.next().then(()=>{e!==this.#i||!this.open||!this.$fastController.isConnected||requestAnimationFrame(()=>{if(e!==this.#i||!this.open||!this.$fastController.isConnected)return;let o=this.panelElement();if(o&&!o.matches(":popover-open")&&o.showPopover(),this.positionPanel(),i!=="search"&&this.filteredOptions.length>0){this.focusListboxControl(i==="last");return}this.focusSearch(!0)})})}focusTrigger(){this.triggerElement()?.focus()}removeViewportListeners(){this.#r?.removeEventListener("scroll",this.#n,!0),this.#r=null,this.ownerDocument.defaultView?.removeEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.removeEventListener("resize",this.#n)}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),o=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!o)return;let r=i.getBoundingClientRect(),n=8,s=6;e.style.inlineSize=`${Math.min(Math.max(r.width,288),o.innerWidth-n*2)}px`;let a=e.getBoundingClientRect(),l=Math.max(n,Math.min(r.left,o.innerWidth-a.width-n)),d=r.bottom+s,u=d+a.height<=o.innerHeight-n?d:r.top-a.height-s;e.style.left=`${l}px`,e.style.top=`${Math.max(n,Math.min(u,o.innerHeight-a.height-n))}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(e=!1){let i=this.listboxElement(),o=i?.shadowRoot?.querySelector('[role="listbox"]');i&&this.filteredOptions.length>0&&(i.activeValue=(e?this.filteredOptions.at(-1):this.filteredOptions[0])?.value??""),o?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}};c(zt.prototype,"placeholder");c({mode:"boolean"})(zt.prototype,"disabled");f(zt.prototype,"selectedValues");f(zt.prototype,"options");f(zt.prototype,"open");f(zt.prototype,"filterQuery");var nh={name:"violet-data-grid-multi-picker",template:mb,styles:fb,shadowOptions:{delegatesFocus:!0}};function ho(t){let e=new Set,i=[];for(let o of t){let r=String(o??"").trim();!r||e.has(r)||(e.add(r),i.push(r))}return i}function sh(t){if(Array.isArray(t))return ho(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return ho(i)}catch{}return ho(e.split(/\s*,\s*/u))}function mn(t){return JSON.stringify(ho(t))}var vb=0,ah=3,gb=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_text-primary);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_size-font-md:var(--violet-type-body-size,14px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

:host([disabled]){
opacity:0.7;
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.trigger{
display:inline-flex;
align-items:center;
justify-content:flex-start;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding:0;
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}

.trigger:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
border-radius:var(--_radius-md);
}

.trigger:disabled{
cursor:not-allowed;
}

.selection{
display:inline-flex;
align-items:center;
gap:0.5rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.25rem 0.5625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:0.8125rem;
font-weight:400;
line-height:1;
}

.selection[data-empty="true"]{
background:var(--_surface-subtle);
border-color:color-mix(in srgb,var(--_border-subtle) 85%,transparent);
color:var(--_text-secondary);
}

.summary{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.persona-stack{
display:inline-flex;
align-items:center;
min-inline-size:0;
flex:0 0 auto;
}

.stack-item{
display:inline-flex;
align-items:center;
justify-content:center;
margin-inline-start:-0.375rem;
border-radius:999px;
background:var(--_surface-page);
}

.stack-item:first-child{
margin-inline-start:0;
}

.stack-overflow{
display:inline-flex;
align-items:center;
justify-content:center;
min-inline-size:1.5rem;
min-block-size:1.5rem;
margin-inline-start:-0.375rem;
padding-inline:0.375rem;
border:1px solid color-mix(in srgb,var(--_border-subtle) 80%,transparent);
border-radius:999px;
background:color-mix(in srgb,var(--_surface-subtle) 88%,white);
color:var(--_text-secondary);
font-size:0.75rem;
line-height:1;
}

violet-persona.stack-persona,
violet-persona.option-persona{
--violet-persona-size:1.5rem;
--violet-persona-font-size:0.625rem;
}

violet-persona.option-persona{
--violet-persona-size:1.75rem;
--violet-persona-font-size:0.75rem;
}

.caret{
inline-size:0.375rem;
block-size:0.375rem;
flex:0 0 auto;
margin-inline-start:0.0625rem;
border-inline-end:1.25px solid currentColor;
border-block-end:1.25px solid currentColor;
transform:translateY(-2.5px) rotate(45deg);
opacity:0.78;
}

.panel{
position:fixed;
inset:unset;
margin:0;
box-sizing:border-box;
z-index:var(--_layer-popover);
display:none;
gap:0.5rem;
inline-size:min(20rem,calc(100vw - 16px));
max-block-size:calc(100vh - 16px);
overflow:auto;
min-inline-size:0;
padding:0.5rem;
border:1px solid color-mix(in srgb,var(--_border-strong) 50%,transparent);
border-radius:var(--_radius-md);
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
color:var(--_text-primary);
}

.panel:popover-open{
display:grid;
}

@media (forced-colors:active){
.trigger:focus-visible,
.search:focus-visible{
outline:2px solid Highlight;
}

.panel{
border-color:CanvasText;
}
}

.search{
inline-size:100%;
min-inline-size:0;
padding:0.5rem 0.625rem;
border:1px solid var(--_field-border);
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_field-background);
color:var(--_field-text);
font:inherit;
font-size:var(--_size-font-md);
outline:none;
box-sizing:border-box;
}

.search:hover{
border-color:var(--_field-border-hover);
}

.search:focus-visible{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

.selection-summary{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
line-height:1.2;
padding-inline:0.125rem;
}

.listbox{
--violet-listbox-min-inline-size:100%;
--violet-listbox-max-block-size:13rem;
--violet-listbox-padding:0.25rem;
}

.option-check{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
font-weight:700;
line-height:1;
}

.empty{
padding:0.5rem 0.25rem 0.25rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
}
`,bb=h`
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
                ${g(t=>t.selectedValues.length>0,h`
                        <span class="persona-stack">
                            ${N(t=>t.visibleSelectedEntries,h`
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
                            ${g(t=>t.overflowCount>0,h`
                                    <span class="stack-overflow" part="overflow-pill">+${t=>t.overflowCount}</span>
                                `)}
                        </span>
                    `)}
                <span class="summary">${t=>t.selectionLabel}</span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${g(t=>t.open,h`
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
                    ${g(t=>t.filteredOptions.length>0,h`
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
                                ${N(t=>t.filteredOptions,h`
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
                                            ${g(t=>!!t.description,h`
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
                    ${g(t=>t.filteredOptions.length===0,h`
                            <div class="empty" part="empty-state">No matching people</div>
                        `)}
                </div>
            `)}
    </div>
`,at=class extends y{#e=++vb;#t="[]";#o=null;#i=0;#r=null;#s=null;#n=[];#a=()=>this.positionPanel();#d=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#l=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let o=e.composedPath();if(e.type==="pointerup"&&o.includes(i)){let n=i.options.find(s=>o.includes(s));n&&!n.isDisabled&&(i.activeValue=n.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#c=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#u=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let o=this.listboxElement();e.button===0&&o&&!this.disabled&&i.includes(o)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.multiple=!0,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("keydown",this.#c,!0),this.addEventListener("focusout",this.#d),this.ownerDocument.addEventListener("pointerdown",this.#u,!0),this.ownerDocument.addEventListener("pointerup",this.#l,!0),this.ownerDocument.addEventListener("pointercancel",this.#l,!0)}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#u,!0),this.ownerDocument.removeEventListener("pointerup",this.#l,!0),this.ownerDocument.removeEventListener("pointercancel",this.#l,!0),this.removeEventListener("keydown",this.#c,!0),this.removeEventListener("focusout",this.#d),this.close(!1),super.disconnectedCallback()}disabledChanged(){this.disabled&&this.close(!0)}handlePanelToggle(e){e.newState==="closed"&&e.currentTarget===this.panelElement()&&!this.panelElement()?.matches(":popover-open")&&this.close(!0)}handlePanelKeydown(e){this.open&&(e.stopPropagation(),e.key==="Escape"&&!e.isComposing&&e.keyCode!==229&&(e.preventDefault(),this.close(!0),this.focusTrigger()))}get value(){return mn(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Assign people"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Assign people")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get selectedEntries(){return this.selectedValues.map(e=>{let i=lo(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,ah)}get overflowCount(){return Math.max(0,this.selectedValues.length-ah)}get selectionLabel(){return this.selectedValues.length===0?this.placeholder||"Assign people":this.selectedValues.length===1?this.selectedEntries[0]?.label??"1 assignee":`${this.selectedEntries[0]?.label??`${this.selectedValues.length} assignees`} +${this.selectedValues.length-1}`}get selectionSummary(){return this.selectedValues.length===0?"No assignees":`${this.selectedValues.length} assignee${this.selectedValues.length===1?"":"s"}`}get filteredOptions(){return ao(this.options,this.filterQuery)}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel("listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??""}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"){e.preventDefault(),e.stopPropagation(),this.focusListboxControl();return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,o=new Set(this.filteredOptions.map(s=>s.value)),r=this.selectedValues.filter(s=>!o.has(s)),n=this.multiple?[...r,...i?.selectedValues??[]]:i?.value?[i.value]:[];this.applySelection(n,"input"),this.multiple||(this.close(!0),this.focusTrigger())}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}toggleValue(e){if(this.disabled)return;if(!this.multiple){let o=this.selectedValues.length===1&&this.selectedValues[0]===e;this.applySelection(o?[]:[e],"input");return}let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}syncSelectionFromValue(e){let i=sh(e),o=this.multiple?i:i.slice(0,1);o.length===this.selectedValues.length&&o.every((r,n)=>r===this.selectedValues[n])||(this.selectedValues=o)}applySelection(e,i){let o=ho(e);this.selectedValues=this.multiple?this.orderedSelectedValues(new Set(o)):o.slice(0,1),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(r=>e.has(r.value)).map(r=>r.value),o=[...e].filter(r=>!this.options.some(n=>n.value===r));return[...i,...o]}close(e){this.#s=null,this.#i+=1,this.stopPanelTracking();let i=this.panelElement();if(i?.matches(":popover-open")&&i.hidePopover(),!this.open)return;let o=mn(this.selectedValues),r=o!==this.#t;this.#o=null,this.open=!1,this.filterQuery="",e&&r&&this.$emit("change",{value:o,selectedValues:[...this.selectedValues]})}openPanel(e){this.open||(this.#t=mn(this.selectedValues)),this.#o=e,this.open=!0,this.queueOpenFocus()}queueOpenFocus(){let e=this.#o;if(this.#o=null,!e)return;let i=++this.#i;M.next().then(()=>{if(!this.open||!this.$fastController.isConnected||i!==this.#i)return;let o=this.panelElement();o&&(o.matches(":popover-open")||o.showPopover(),this.startPanelTracking(),this.positionPanel(),this.#r=requestAnimationFrame(()=>{if(this.#r=null,!(!this.open||!this.$fastController.isConnected||i!==this.#i)){if(e==="listbox"&&this.filteredOptions.length>0){this.focusListboxControl();return}this.focusSearch(!0)}}))})}focusTrigger(){this.#r=requestAnimationFrame(()=>{this.#r=null,!(this.open||this.disabled||!this.$fastController.isConnected)&&this.triggerElement()?.focus()})}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}startPanelTracking(){this.stopPanelTracking();let e=this.getRootNode();for(;e instanceof ShadowRoot;)this.#n.push(e),e=e.host.getRootNode();this.#n.push(this.ownerDocument),this.#n.forEach(i=>{i.addEventListener("scroll",this.#a,!0)}),this.ownerDocument.defaultView?.addEventListener("resize",this.#a)}stopPanelTracking(){this.#n.forEach(e=>{e.removeEventListener("scroll",this.#a,!0)}),this.#n.length=0,this.ownerDocument.defaultView?.removeEventListener("resize",this.#a),this.#r!==null&&(cancelAnimationFrame(this.#r),this.#r=null)}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),o=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!o)return;let r=i.getBoundingClientRect(),n=e.getBoundingClientRect(),s=8,a=r.bottom+6,l=a+n.height<=o.innerHeight-s?a:r.top-n.height-6;e.style.left=`${Math.max(s,Math.min(r.left,o.innerWidth-n.width-s))}px`,e.style.top=`${Math.max(s,l)}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(){this.listboxElement()?.shadowRoot?.querySelector(".control")?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}};c(at.prototype,"placeholder");c({mode:"boolean"})(at.prototype,"disabled");c({mode:"boolean"})(at.prototype,"multiple");f(at.prototype,"selectedValues");f(at.prototype,"options");f(at.prototype,"open");f(at.prototype,"filterQuery");var lh={name:"violet-data-grid-persona-picker",template:bb,styles:gb,shadowOptions:{delegatesFocus:!0}};var yb=0;function Ys(t){return t.isComposing||t.keyCode===229}var xb=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_text-primary);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_radius-sm:var(--violet-radius-inset,4px);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_pill-font-size:var(--violet-data-grid-pill-font-size,0.8125rem);
--_size-font-md:var(--violet-type-body-size,14px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.trigger{
display:inline-flex;
align-items:center;
justify-content:flex-start;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding:0;
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}

.trigger:focus-visible{
outline:none;
}

.pill{
display:inline-flex;
align-items:center;
justify-content:center;
gap:0.3125rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.625rem 0.5625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:var(--_pill-font-size);
font-weight:400;
line-height:1;
}

.pill-label{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.pill[data-empty="true"]{
background:var(--_surface-subtle);
border-color:color-mix(in srgb,var(--_border-subtle) 85%,transparent);
color:var(--_text-secondary);
}

.caret{
inline-size:0.375rem;
block-size:0.375rem;
flex:0 0 auto;
margin-inline-start:0.0625rem;
border-inline-end:1.25px solid currentColor;
border-block-end:1.25px solid currentColor;
transform:translateY(-2.5px) rotate(45deg);
opacity:0.78;
}

.panel{
position:absolute;
inset-inline-start:0;
inset-block-start:calc(100% + 0.375rem);
z-index:var(--_layer-popover);
display:grid;
gap:0.5rem;
inline-size:min(16rem,max(12rem,100%));
min-inline-size:0;
padding:0.5rem;
border:1px solid color-mix(in srgb,var(--_border-strong) 50%,transparent);
border-radius:var(--_radius-md);
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
}

.search{
inline-size:100%;
min-inline-size:0;
padding:0.5rem 0.625rem;
border:1px solid var(--_field-border);
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_field-background);
color:var(--_field-text);
font:inherit;
font-size:var(--_size-font-md);
outline:none;
box-sizing:border-box;
}

.search:hover{
border-color:var(--_field-border-hover);
}

.search:focus-visible{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

.options{
display:grid;
gap:0.375rem;
max-block-size:12rem;
overflow:auto;
padding:0.125rem;
}

.option{
display:grid;
justify-items:start;
padding:0;
border:none;
background:transparent;
color:inherit;
text-align:start;
cursor:pointer;
}

.option:focus-visible{
outline:none;
}

.option:focus-visible .option-pill{
box-shadow:0 0 0 2px var(--_focus-ring);
}

.option-pill{
display:inline-flex;
align-items:center;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.625rem;
padding-inline:0.75rem;
border:1px solid transparent;
border-radius:999px;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
font-size:var(--_pill-font-size);
font-weight:400;
line-height:1;
}

.empty{
padding:0.5rem 0.25rem 0.25rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
}

.error-text{
display:block;
color:var(--_danger-text);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
margin-block-start:var(--_space-field-gap);
}

:host([error-announcement="external"]) .error-text{
position:absolute;
inline-size:1px;
block-size:1px;
padding:0;
margin:-1px;
overflow:hidden;
clip:rect(0 0 0 0);
white-space:nowrap;
border:0;
}
`,wb=h`
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
            aria-describedby="${t=>t.displayErrorText?t.errorTextId:null}"
            aria-errormessage="${t=>t.displayErrorText?t.errorTextId:null}"
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

        ${g(t=>!!t.displayErrorText,h`
                <span
                    class="error-text"
                    part="error-message"
                    role="${t=>t.errorAnnouncement==="self"?"alert":null}"
                    id="${t=>t.errorTextId}"
                >
                    ${t=>t.displayErrorText}
                </span>
            `)}

        ${g(t=>t.open,h`
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
                        ${N(t=>t.filteredOptions,h`
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
                        ${g(t=>t.filteredOptions.length===0,h`
                                <div class="empty">No matching options</div>
                            `)}
                    </div>
                </div>
            `)}
    </div>
`,Pe=class extends y{#e;#t;constructor(){super(),this.instanceId=++yb,this.#e=e=>{!this.open||e.composedPath().includes(this)||this.close()},this.#t=e=>{this.handleFocusOut(e)},this.options=[],this.invalid=!1,this.errorText="",this.errorAnnouncement="self",this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#t),this.ownerDocument.addEventListener("pointerdown",this.#e,!0),this.openChanged()}disconnectedCallback(){this.ownerDocument.removeEventListener("pointerdown",this.#e,!0),this.removeEventListener("focusout",this.#t),super.disconnectedCallback()}get selectedOption(){return this.options.find(e=>e.value===this.value)??null}get selectedLabel(){return this.selectedOption?.label||this.value||this.placeholder||"Select an option"}get triggerLabel(){return this.controlLabel?`${this.controlLabel}: ${this.selectedLabel}`:this.selectedLabel}get selectedOptionStyle(){return this.selectedOption?this.optionStyle(this.selectedOption):""}get filteredOptions(){let e=this.filterQuery.trim().toLowerCase();return e?this.options.filter(i=>[i.label,i.value,...i.keywords??[]].join(" ").toLowerCase().includes(e)):this.options}get panelId(){return`${this.localName}-panel-${this.instanceId}`}get displayErrorText(){return Q({invalid:this.invalid,errorText:this.errorText})}get errorTextId(){return`${this.localName}-error-${this.instanceId}`}handleTriggerClick(){if(this.open){this.close();return}this.openPanel("search")}handleTriggerKeydown(e){return Ys(e)?!0:e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.openPanel(this.value?"selected":"first"),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),this.openPanel(this.value?"selected":"last"),!1):e.key===" "||e.key==="Enter"?(e.preventDefault(),e.stopPropagation(),this.open?this.close():this.openPanel("search"),!1):!0}handleSearchInput(e){let i=e.target;return this.filterQuery=i?.value??"",!0}handleSearchKeydown(e){return Ys(e)?!0:e.key==="Escape"?(e.preventDefault(),e.stopPropagation(),this.close(),this.focusTrigger(),!1):e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(0),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(this.filteredOptions.length-1),!1):!0}handleOptionKeydown(e,i){if(Ys(e))return!0;let o=this.filteredOptions.findIndex(r=>r.value===i);return e.key==="ArrowDown"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(Math.min(o+1,this.filteredOptions.length-1)),!1):e.key==="ArrowUp"?(e.preventDefault(),e.stopPropagation(),o<=0?(this.focusSearch(),!1):(this.focusOptionByIndex(o-1),!1)):e.key==="Home"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(0),!1):e.key==="End"?(e.preventDefault(),e.stopPropagation(),this.focusOptionByIndex(this.filteredOptions.length-1),!1):e.key==="Escape"?(e.preventDefault(),e.stopPropagation(),this.close(),this.focusTrigger(),!1):e.key===" "||e.key==="Enter"?(e.preventDefault(),e.stopPropagation(),this.selectOption(i),!1):!0}handleFocusOut(e){let i=e.relatedTarget;return i&&(i===this||this.shadowRoot?.contains(i))||this.close(),!0}openChanged(){this.triggerElement()?.setAttribute("tabindex",this.open?"-1":"0")}selectOption(e){if(this.value===e){this.close(),this.focusTrigger();return}this.value=e,this.close(),this.$emit("input"),this.$emit("change"),this.focusTrigger()}optionStyle(e){let i=this.resolveOptionVisuals(e);return`background:${i.background};color:${i.foreground};border-color:${i.borderColor};`}close(){this.open=!1,this.filterQuery=""}focusTrigger(){requestAnimationFrame(()=>{this.triggerElement()?.focus()})}openPanel(e){this.open=!0,requestAnimationFrame(()=>{switch(e){case"search":this.focusSearch(!0);break;case"first":this.focusOptionByIndex(0);break;case"last":this.focusOptionByIndex(this.filteredOptions.length-1);break;case"selected":{this.focusOptionByIndex(this.selectedOptionIndex());break}}})}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusOptionByIndex(e){let i=this.optionElements();if(!i.length)return;let o=Math.max(0,Math.min(e,i.length-1));i[o]?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}optionElements(){return Array.from(this.shadowRoot?.querySelectorAll(".option")??[])}selectedOptionIndex(){let e=this.filteredOptions.findIndex(i=>i.value===this.value);return e>=0?e:0}resolveOptionVisuals(e){if(e.background||e.foreground||e.borderColor)return{background:no("background",e.background)??"var(--_surface-subtle)",foreground:no("color",e.foreground)??"var(--_text-primary)",borderColor:no("border-color",e.borderColor)??"transparent"};switch(e.tone){case"teal":return{background:"#0b7280",foreground:"#ffffff",borderColor:"transparent"};case"green":return{background:"#176c27",foreground:"#ffffff",borderColor:"transparent"};case"olive":return{background:"#547d46",foreground:"#f5fbf2",borderColor:"transparent"};case"gold":return{background:"#8b6b24",foreground:"#fff7de",borderColor:"transparent"};case"blue":return{background:"#416b89",foreground:"#ffffff",borderColor:"transparent"};case"gray":return{background:"#606672",foreground:"#f6f7fa",borderColor:"transparent"};default:return{background:"color-mix(in srgb, var(--_surface-subtle) 90%, white)",foreground:"var(--_text-primary)",borderColor:"color-mix(in srgb, var(--_border-subtle) 80%, transparent)"}}}};c(Pe.prototype,"value");c({attribute:"control-label"})(Pe.prototype,"controlLabel");c(Pe.prototype,"placeholder");c({mode:"boolean"})(Pe.prototype,"invalid");c({attribute:"error-text"})(Pe.prototype,"errorText");c({attribute:"error-announcement"})(Pe.prototype,"errorAnnouncement");f(Pe.prototype,"options");f(Pe.prototype,"open");f(Pe.prototype,"filterQuery");var ch={name:"violet-data-grid-pill-select",template:wb,styles:xb,shadowOptions:{delegatesFocus:!0}};function po(t){let e=new Set,i=[];for(let o of t){let r=String(o??"").trim();!r||e.has(r)||(e.add(r),i.push(r))}return i}function dh(t){if(Array.isArray(t))return po(t);if(typeof t!="string")return[];let e=t.trim();if(!e)return[];try{let i=JSON.parse(e);if(Array.isArray(i))return po(i)}catch{}return po(e.split(/\s*,\s*/u))}function vn(t){return JSON.stringify(po(t))}var _b=0,uh=2,kb=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_text-primary);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_surface-floating:var(--violet-color-surface-floating,#ffffff);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_border-subtle:var(--violet-color-border-subtle,rgba(24,27,26,0.10));
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_text-primary:var(--violet-color-text-primary,#181b1a);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_radius-sm:var(--violet-radius-inset,4px);
--_radius-md:var(--violet-radius-control,8px);
--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_pill-font-size:var(--violet-data-grid-pill-font-size,0.8125rem);
--_size-font-md:var(--violet-type-body-size,14px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

:host([disabled]){
opacity:0.7;
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.trigger{
display:inline-flex;
align-items:center;
justify-content:flex-start;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding:0;
border:none;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}

.trigger:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:2px;
border-radius:var(--_radius-sm);
}

.trigger:disabled{
cursor:not-allowed;
}

.selection{
display:inline-flex;
align-items:center;
gap:0.25rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.5rem;
padding-inline:0.25rem 0.5625rem;
border:1px solid transparent;
border-radius:999px;
box-sizing:border-box;
font-size:var(--_pill-font-size);
font-weight:400;
line-height:1;
}

.selection[data-empty="true"]{
background:var(--_surface-subtle);
border-color:color-mix(in srgb,var(--_border-subtle) 85%,transparent);
color:var(--_text-secondary);
}

.references{
display:inline-flex;
align-items:center;
gap:0.25rem;
min-inline-size:0;
max-inline-size:100%;
overflow:hidden;
}

.reference-pill{
display:inline-flex;
align-items:center;
gap:0.375rem;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.375rem;
padding-inline:0.625rem;
border:1px solid color-mix(in srgb,var(--_border-subtle) 80%,transparent);
border-radius:999px;
box-sizing:border-box;
background:color-mix(in srgb,var(--_surface-subtle) 82%,white);
color:var(--_text-primary);
font-size:var(--_pill-font-size);
line-height:1;
}

.pill-label,
.placeholder{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.pill-dot{
inline-size:0.5rem;
block-size:0.5rem;
flex:0 0 auto;
border-radius:999px;
border:1px solid color-mix(in srgb,var(--_border-subtle) 75%,transparent);
box-sizing:border-box;
}

.overflow-pill{
background:color-mix(in srgb,var(--_surface-subtle) 88%,white);
border-color:color-mix(in srgb,var(--_border-subtle) 80%,transparent);
color:var(--_text-secondary);
}

.caret{
inline-size:0.375rem;
block-size:0.375rem;
flex:0 0 auto;
margin-inline-start:0.0625rem;
border-inline-end:1.25px solid currentColor;
border-block-end:1.25px solid currentColor;
transform:translateY(-2.5px) rotate(45deg);
opacity:0.78;
}

.panel{
position:fixed;
inset:unset;
margin:0;
box-sizing:border-box;
max-inline-size:calc(100vw - 16px);
max-block-size:calc(100vh - 16px);
overflow:auto;
z-index:var(--_layer-popover);
display:grid;
gap:0.5rem;
inline-size:min(20rem,max(15rem,100%));
min-inline-size:0;
padding:0.5rem;
border:1px solid color-mix(in srgb,var(--_border-strong) 50%,transparent);
border-radius:var(--_radius-md);
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
}

.search{
inline-size:100%;
min-inline-size:0;
padding:0.5rem 0.625rem;
border:1px solid var(--_field-border);
border-radius:calc(var(--_radius-md) - 2px);
background:var(--_field-background);
color:var(--_field-text);
font:inherit;
font-size:var(--_size-font-md);
outline:none;
box-sizing:border-box;
}

.search:hover{
border-color:var(--_field-border-hover);
}

.search:focus-visible{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

.selection-summary{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
line-height:1.2;
padding-inline:0.125rem;
}

.listbox{
--violet-listbox-min-inline-size:100%;
--violet-listbox-max-block-size:13rem;
--violet-listbox-padding:0.25rem;
}

.option-token{
inline-size:1.5rem;
block-size:1.5rem;
display:inline-flex;
align-items:center;
justify-content:center;
flex:0 0 auto;
border-radius:999px;
border:1px solid transparent;
box-sizing:border-box;
font-size:0.6875rem;
font-weight:700;
line-height:1;
text-transform:uppercase;
}

.option-check{
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
font-weight:700;
line-height:1;
}

.create-action{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:100%;
min-block-size:2rem;
padding-inline:0.75rem;
border:1px dashed color-mix(in srgb,var(--_border-strong) 45%,transparent);
border-radius:calc(var(--_radius-md) - 2px);
background:color-mix(in srgb,var(--_surface-subtle) 48%,white);
color:var(--_text-primary);
font:inherit;
font-size:var(--_size-font-sm);
cursor:pointer;
}

.create-action:focus-visible{
outline:none;
border-color:color-mix(in srgb,var(--_focus-ring) 55%,transparent);
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 25%,transparent);
}

.empty{
padding:0.5rem 0.25rem 0.25rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
}
`,Cb=h`
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
                    ${g(t=>t.selectedValues.length===0,h`
                            <span class="placeholder">${t=>t.placeholder||"Link records"}</span>
                        `)}
                    ${N(t=>t.visibleSelectedEntries,h`
                            <span class="reference-pill" part="pill">
                                <span class="pill-dot" style="${(t,e)=>e.parent.pillDotStyleForValue(t.value)}"></span>
                                <span class="pill-label">${t=>t.label}</span>
                            </span>
                        `)}
                    ${g(t=>t.overflowCount>0,h`
                            <span class="reference-pill overflow-pill" part="overflow-pill">+${t=>t.overflowCount}</span>
                        `)}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${g(t=>t.open,h`
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
                                ${N(t=>t.filteredOptions,h`
                                        <violet-option value="${t=>t.value}" label="${t=>t.label}">
                                            <span
                                                slot="before"
                                                class="option-token"
                                                style="${(t,e)=>e.parent.optionTokenStyle(t)}"
                                            >
                                                ${(t,e)=>e.parent.optionTokenText(t)}
                                            </span>
                                            ${g(t=>!!t.description,h`
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
                    ${g(t=>t.filteredOptions.length===0&&!t.hasCreateAction,h`
                            <div class="empty" part="empty-state" role="status">No matching records</div>
                        `)}
                    ${g(t=>t.hasCreateAction,h`
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
`,Xe=class extends y{#e=++_b;#t="[]";#o=null;#i=0;#r=null;#s=null;#n=e=>{let i=this.panelElement();i&&!e.composedPath().includes(i)&&this.positionPanel()};#a=e=>{let i=e.relatedTarget;i&&(i===this||this.shadowRoot?.contains(i))||!i&&this.#s!==null||this.close(!0)};#d=e=>{if(e.pointerId!==this.#s)return;this.#s=null;let i=this.listboxElement();if(!this.open||!i||!this.$fastController.isConnected)return;let o=e.composedPath();if(e.type==="pointerup"&&o.includes(i)){let n=i.options.find(s=>o.includes(s));n&&!n.isDisabled&&(i.activeValue=n.value),i.shadowRoot?.querySelector('[role="listbox"]')?.focus();return}this.getRootNode().activeElement!==this&&this.close(!0)};#l=e=>{let i=this.listboxElement();i&&(e.isComposing||e.keyCode===229||e.key==="Tab")&&e.composedPath().includes(i)&&e.stopPropagation()};#c=e=>{if(!this.open)return;let i=e.composedPath();if(i.includes(this)){let o=this.listboxElement();e.button===0&&o&&!this.disabled&&i.includes(o)&&(this.#s=e.pointerId);return}this.close(!0)};constructor(){super(),this.placeholder="",this.disabled=!1,this.multiple=!0,this.allowCreate=!1,this.selectedValues=[],this.options=[],this.open=!1,this.filterQuery=""}connectedCallback(){super.connectedCallback(),this.addEventListener("focusout",this.#a),this.addEventListener("keydown",this.#l,!0),this.ownerDocument.addEventListener("pointerdown",this.#c,!0),this.ownerDocument.addEventListener("pointerup",this.#d,!0),this.ownerDocument.addEventListener("pointercancel",this.#d,!0)}disconnectedCallback(){this.close(!1),this.removeViewportListeners(),this.#i+=1,this.removeEventListener("focusout",this.#a),this.removeEventListener("keydown",this.#l,!0),this.ownerDocument.removeEventListener("pointerdown",this.#c,!0),this.ownerDocument.removeEventListener("pointerup",this.#d,!0),this.ownerDocument.removeEventListener("pointercancel",this.#d,!0),super.disconnectedCallback()}get value(){return vn(this.selectedValues)}set value(e){this.syncSelectionFromValue(e)}get triggerLabel(){return this.getAttribute("aria-label")||this.placeholder||"Link records"}get triggerLabelledBy(){return this.selectedValues.length===0&&this.triggerLabel===(this.placeholder||"Link records")?"trigger-value":"trigger-label trigger-value"}get panelId(){return`${this.localName}-panel-${this.#e}`}get listboxId(){return`${this.panelId}-listbox`}disabledChanged(){this.disabled&&this.open&&this.close(!0)}handlePanelToggle(e){let i=this.panelElement();e.newState==="closed"&&i&&!i.matches(":popover-open")&&this.close(!0)}filterQueryChanged(){M.next().then(()=>this.positionPanel())}get selectedEntries(){return this.selectedValues.map(e=>{let i=lo(this.options,e);return{label:i.label,option:i.value===e?i:null,value:e}})}get visibleSelectedEntries(){return this.selectedEntries.slice(0,uh)}get overflowCount(){return Math.max(0,this.selectedValues.length-uh)}get selectionSummary(){return this.selectedValues.length===0?"No linked records":`${this.selectedValues.length} linked record${this.selectedValues.length===1?"":"s"}`}get filteredOptions(){return ao(this.options,this.filterQuery)}get hasCreateAction(){let e=this.normalizedQuery();return!this.allowCreate||!e?!1:!this.options.some(i=>{let o=i.label.trim().toLowerCase(),r=i.value.trim().toLowerCase();return o===e||r===e})}get createActionText(){return`Create "${this.filterQuery.trim()}"`}handleTriggerClick(){if(!this.disabled){if(this.open){this.close(!0),this.focusTrigger();return}this.openPanel("search")}}handleTriggerKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key===" "||e.key==="Enter"){e.preventDefault(),e.stopPropagation(),this.open?this.close(!0):this.openPanel("search");return}(e.key==="ArrowDown"||e.key==="ArrowUp")&&(e.preventDefault(),e.stopPropagation(),this.openPanel(e.key==="ArrowUp"?"last":"listbox"))}}handleSearchInput(e){e.stopPropagation();let i=e.target;this.filterQuery=i?.value??"",this.$emit("query-change",{query:this.filterQuery})}handleSearchKeydown(e){if(!(this.disabled||e.isComposing||e.keyCode===229)){if(e.key==="Escape"){e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger();return}if(e.key==="ArrowDown"||e.key==="ArrowUp"){if(e.preventDefault(),e.stopPropagation(),this.filteredOptions.length>0){this.focusListboxControl(e.key==="ArrowUp");return}this.hasCreateAction&&this.focusCreateAction();return}if(e.key==="Enter"&&this.hasCreateAction&&this.filteredOptions.length===0){e.preventDefault(),e.stopPropagation(),this.handleCreateAction();return}e.key==="Backspace"&&!this.filterQuery&&this.selectedValues.length>0&&(e.preventDefault(),e.stopPropagation(),this.applySelection(this.selectedValues.slice(0,-1),"input"))}}handleListboxInput(e){if(e.stopPropagation(),this.disabled)return;let i=e.detail,o=new Set(this.filteredOptions.map(s=>s.value)),r=this.selectedValues.filter(s=>!o.has(s)),n=this.multiple?[...r,...i?.selectedValues??[]]:i?.value?[i.value]:[];this.applySelection(n,"input"),this.multiple||(this.close(!0),this.focusTrigger())}handleListboxChange(e){e.stopPropagation()}handleListboxKeydown(e){e.isComposing||e.keyCode===229||e.key==="Escape"&&(e.preventDefault(),e.stopPropagation(),this.close(!0),this.focusTrigger())}handleCreateAction(){let e=this.filterQuery.trim();this.disabled||!e||!this.hasCreateAction||this.$emit("create-request",{query:e})}toggleValue(e){if(this.disabled)return;if(!this.multiple){let o=this.selectedValues.length===1&&this.selectedValues[0]===e;this.applySelection(o?[]:[e],"input");return}let i=new Set(this.selectedValues);i.has(e)?i.delete(e):i.add(e),this.applySelection(this.orderedSelectedValues(i),"input")}toggleOption(e){this.toggleValue(e)}isSelected(e){return this.selectedValues.includes(e)}optionTokenStyle(e){let i=co(e);return`background:${i.background};color:${i.foreground};border-color:${i.borderColor};`}optionTokenText(e){let i=e.label.trim().split(/\s+/u).filter(Boolean);return i.length===0?"?":i.length===1?i[0].slice(0,2):`${i[0][0]??""}${i[1][0]??""}`}pillDotStyleForValue(e){let i=this.options.find(r=>r.value===e);return`background:${co(i??{label:e,value:e}).background};`}normalizedQuery(){return this.filterQuery.trim().toLowerCase()}syncSelectionFromValue(e){let i=dh(e),o=this.multiple?i:i.slice(0,1);o.length===this.selectedValues.length&&o.every((r,n)=>r===this.selectedValues[n])||(this.selectedValues=o)}applySelection(e,i){let o=po(e);this.selectedValues=this.multiple?this.orderedSelectedValues(new Set(o)):o.slice(0,1),this.$emit(i,{value:this.value,selectedValues:[...this.selectedValues]})}orderedSelectedValues(e){let i=this.options.filter(r=>e.has(r.value)).map(r=>r.value),o=[...e].filter(r=>!this.options.some(n=>n.value===r));return[...i,...o]}close(e){if(this.#s=null,!this.open)return;this.#i+=1;let i=vn(this.selectedValues),o=i!==this.#t;this.#o=null,this.open=!1;let r=this.panelElement();r?.matches(":popover-open")&&r.hidePopover(),this.removeViewportListeners(),this.filterQuery="",e&&o&&this.$emit("change",{value:i,selectedValues:[...this.selectedValues]})}openPanel(e){if(this.disabled)return;this.#i+=1,this.open||(this.#t=vn(this.selectedValues)),this.#o=e,this.open=!0;let i=this.getRootNode();this.#r=i instanceof ShadowRoot?i:null,this.#r?.addEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.addEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.addEventListener("resize",this.#n),this.queueOpenFocus()}queueOpenFocus(){let e=this.#i,i=this.#o;this.#o=null,i&&M.next().then(()=>{e!==this.#i||!this.open||!this.$fastController.isConnected||requestAnimationFrame(()=>{if(e!==this.#i||!this.open||!this.$fastController.isConnected)return;let o=this.panelElement();if(o&&!o.matches(":popover-open")&&o.showPopover(),this.positionPanel(),i!=="search"&&this.filteredOptions.length>0){this.focusListboxControl(i==="last");return}this.focusSearch(!0)})})}focusTrigger(){this.triggerElement()?.focus()}removeViewportListeners(){this.#r?.removeEventListener("scroll",this.#n,!0),this.#r=null,this.ownerDocument.defaultView?.removeEventListener("scroll",this.#n,!0),this.ownerDocument.defaultView?.removeEventListener("resize",this.#n)}panelElement(){return this.shadowRoot?.querySelector(".panel")??null}positionPanel(){let e=this.panelElement(),i=this.triggerElement(),o=this.ownerDocument.defaultView;if(!this.open||!e?.matches(":popover-open")||!i||!o)return;let r=i.getBoundingClientRect(),n=8,s=6;e.style.inlineSize=`${Math.min(Math.max(r.width,288),o.innerWidth-n*2)}px`;let a=e.getBoundingClientRect(),l=Math.max(n,Math.min(r.left,o.innerWidth-a.width-n)),d=r.bottom+s,u=d+a.height<=o.innerHeight-n?d:r.top-a.height-s;e.style.left=`${l}px`,e.style.top=`${Math.max(n,Math.min(u,o.innerHeight-a.height-n))}px`}focusSearch(e=!1){let i=this.searchElement();i?.focus(),e&&i?.select()}focusListboxControl(e=!1){let i=this.listboxElement(),o=i?.shadowRoot?.querySelector('[role="listbox"]');i&&this.filteredOptions.length>0&&(i.activeValue=(e?this.filteredOptions.at(-1):this.filteredOptions[0])?.value??""),o?.focus()}focusCreateAction(){this.createActionElement()?.focus()}triggerElement(){return this.shadowRoot?.querySelector(".trigger")}searchElement(){return this.shadowRoot?.querySelector(".search")}listboxElement(){return this.shadowRoot?.querySelector("violet-listbox")??null}createActionElement(){return this.shadowRoot?.querySelector(".create-action")}};c(Xe.prototype,"placeholder");c({mode:"boolean"})(Xe.prototype,"disabled");c({mode:"boolean"})(Xe.prototype,"multiple");c({mode:"boolean",attribute:"allow-create"})(Xe.prototype,"allowCreate");f(Xe.prototype,"selectedValues");f(Xe.prototype,"options");f(Xe.prototype,"open");f(Xe.prototype,"filterQuery");var hh={name:"violet-data-grid-reference-picker",template:Cb,styles:kb,shadowOptions:{delegatesFocus:!0}};function lr(t){let e=Number(t);return Number.isFinite(e)?Math.min(10,Math.max(1,Math.round(e))):5}function di(t,e=5){if(t==null||typeof t=="string"&&t.trim()==="")return null;let i=Number(t);if(!Number.isFinite(i))return null;let o=Math.round(i);return o<=0?null:Math.min(lr(e),o)}function ph(t,e=5){let i=di(t,e);return i===null?"":String(i)}var fh="M12 2.2 14.9 8.2 21.5 9.1 16.8 13.6 17.9 20 12 16.8 6.1 20 7.2 13.6 2.5 9.1 9.1 8.2 12 2.2Z",Sb=b`
    ${V}

:host{
position:relative;
display:inline-grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
color:var(--_rating-filled);
font-family:var(--violet-data-grid-font-family,var(--violet-font-family,var(--violet-font-family-body)));

--_surface-page:var(--violet-color-surface-page,#f4f0ea);
--_surface-subtle:var(--violet-color-surface-subtle,#e9e5de);
--_text-secondary:var(--violet-color-text-secondary,#48534b);
--_text-muted:var(--violet-color-text-muted,#5e6460);
--_focus-ring:var(--violet-color-focus-ring,#28769e);
--_rating-filled:var(--violet-color-state-warning-text,#92400E);
--_rating-empty:color-mix(in srgb,var(--_text-muted) 36%,transparent);
--_rating-hover:color-mix(in srgb,var(--_rating-filled) 82%,var(--_surface-page));
--_radius-md:var(--violet-radius-control,8px);
--_size-font-sm:var(--violet-type-caption-size,12px);
}

:host([disabled]){
opacity:0.68;
}

.root{
position:relative;
display:grid;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
}

.control{
display:inline-flex;
align-items:center;
gap:0.125rem;
inline-size:fit-content;
min-inline-size:0;
max-inline-size:100%;
min-block-size:1.75rem;
padding-inline:0.125rem;
border-radius:999px;
outline:none;
user-select:none;
-webkit-user-select:none;
}

.control[data-interactive="true"]{
cursor:pointer;
}

.control[data-interactive="true"]:hover .star[data-filled="false"]{
color:color-mix(in srgb,var(--_rating-empty) 70%,var(--_rating-hover));
}

.control:focus-visible{
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 28%,transparent);
background:color-mix(in srgb,var(--_surface-subtle) 52%,transparent);
}

.star{
inline-size:1.125rem;
block-size:1.125rem;
display:inline-flex;
align-items:center;
justify-content:center;
flex:0 0 auto;
color:var(--_rating-empty);
transition:
color var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

.star[data-filled="true"]{
color:var(--_rating-filled);
}

.control[data-interactive="true"] .star[data-filled="true"]{
transform:translateY(-0.5px);
}

.star[data-current="true"]{
transform:translateY(-1px) scale(1.02);
}

.star-shape{
inline-size:100%;
block-size:100%;
fill:currentColor;
stroke:color-mix(in srgb,currentColor 92%,var(--_surface-page));
stroke-width:1.25;
vector-effect:non-scaling-stroke;
}

.summary{
margin-inline-start:0.25rem;
color:var(--_text-secondary);
font-size:var(--_size-font-sm);
line-height:1;
white-space:nowrap;
}
`,zb=h`
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
        ${N(t=>t.starValues,h`
                <span
                    class="star"
                    part="star"
                    data-index="${t=>String(t)}"
                    data-filled="${(t,e)=>String(e.parent.isFilled(t))}"
                    data-current="${(t,e)=>String(e.parent.rating===t)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${fh}"></path>
                    </svg>
                </span>
            `)}
        <span class="summary" part="summary">${t=>t.selectionSummary}</span>
    </div>
`,Eb=h`
    <div
        class="control"
        part="control"
        data-interactive="false"
        role="img"
        aria-label="${t=>t.readonlyLabel}"
        aria-disabled="${t=>t.disabled?"true":null}"
    >
        ${N(t=>t.starValues,h`
                <span
                    class="star"
                    part="star"
                    data-index="${t=>String(t)}"
                    data-filled="${(t,e)=>String(e.parent.isFilled(t))}"
                    data-current="${(t,e)=>String(e.parent.rating===t)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${fh}"></path>
                    </svg>
                </span>
            `)}
    </div>
`,Tb=h`
    <div class="root" part="base">
        ${g(t=>t.interactive,zb,Eb)}
    </div>
`,Gt=class extends y{constructor(){super(),this.disabled=!1,this.readonly=!1,this.ariaLabel="",this.rating=null,this.max=5}connectedCallback(){super.connectedCallback(),this.max=lr(this.max),this.rating=di(this.rating,this.max)}ratingChanged(){let e=di(this.rating,this.max);e!==this.rating&&(this.rating=e)}maxChanged(){let e=lr(this.max);if(e!==this.max){this.max=e;return}let i=di(this.rating,e);i!==this.rating&&(this.rating=i)}get value(){return ph(this.rating,this.max)}set value(e){let i=di(e,this.max);i!==this.rating&&(this.rating=i)}focus(e){this.shadowRoot?.querySelector('.control[tabindex="0"]')?.focus(e)}get resolvedMax(){return lr(this.max)}get starValues(){return Array.from({length:this.resolvedMax},(e,i)=>i+1)}get interactive(){return!this.disabled&&!this.readonly}get selectionSummary(){return this.rating===null?"No rating":`${this.rating}/${this.resolvedMax}`}get controlLabel(){return this.ariaLabel||"Rating"}get accessibleValueText(){return this.rating===null?`No rating, out of ${this.resolvedMax}`:`${this.rating} of ${this.resolvedMax}`}get readonlyLabel(){return`${this.controlLabel}: ${this.accessibleValueText}`}isFilled(e){return this.rating!==null&&e<=this.rating}selectRating(e){if(!this.interactive)return;let i=di(e,this.resolvedMax);i!==this.rating&&(this.rating=i,this.emitSelectionChange())}clearRating(){this.selectRating(null)}handleControlClick(e){if(!this.interactive)return;let i=e.composedPath().find(r=>r instanceof HTMLElement&&typeof r.dataset.index=="string");if(!i)return;let o=di(i.dataset.index,this.resolvedMax);this.selectRating(o!==null&&o===this.rating?null:o)}handleControlKeydown(e){if(this.interactive)switch(e.key){case"ArrowRight":case"ArrowUp":e.preventDefault(),this.selectRating(Math.min(this.resolvedMax,(this.rating??0)+1));break;case"ArrowLeft":case"ArrowDown":if(e.preventDefault(),this.rating===null)return;this.selectRating(this.rating>1?this.rating-1:null);break;case"Home":e.preventDefault(),this.selectRating(1);break;case"End":e.preventDefault(),this.selectRating(this.resolvedMax);break;case"Backspace":case"Delete":e.preventDefault(),this.clearRating();break;default:break}}emitSelectionChange(){let e={rating:this.rating,value:this.value};this.$emit("input",e),this.$emit("change",e)}};c({mode:"boolean"})(Gt.prototype,"disabled");c({mode:"boolean"})(Gt.prototype,"readonly");c({attribute:"aria-label",mode:"fromView"})(Gt.prototype,"ariaLabel");f(Gt.prototype,"rating");f(Gt.prototype,"max");var mh={name:"violet-data-grid-rating",template:Tb,styles:Sb,shadowOptions:{delegatesFocus:!0}};function gn(t){let e=t.parentNode;for(;e;)if(e instanceof Element){if(e instanceof HTMLElement&&(e.localName==="dialog"||e.localName==="violet-dialog"))return e;e=e.parentNode}else if(e instanceof ShadowRoot)e=e.host;else break;return null}function $i(t){if(t instanceof HTMLDialogElement)return t.open;let e=t.shadowRoot?.querySelector("dialog");return e instanceof HTMLDialogElement?e.open:t.hasAttribute("open")}function bn(t,e=!1){if(t.hidden=!1,!(!t.isConnected||typeof t.showPopover!="function")){if(t.matches(":popover-open")){if(!e)return;t.hidePopover()}t.showPopover()}}function ui(t){typeof t.hidePopover=="function"&&t.matches(":popover-open")&&t.hidePopover(),t.hidden=!0}function yn(t,e){let i=$i(t),o=()=>{let a=$i(t);a!==i&&(i=a,e(a))},r=new MutationObserver(o);r.observe(t,{attributes:!0,attributeFilter:["open"]});let n=t.shadowRoot?.querySelector("dialog");n instanceof HTMLDialogElement&&r.observe(n,{attributes:!0,attributeFilter:["open"]});let s=a=>{if(a.target===t){let l=$i(t);i=l,e(l)}};return t.addEventListener("open-change",s),()=>{r.disconnect(),t.removeEventListener("open-change",s)}}var Xs=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},cr=0,$b=b`
    ${V}

:host{
position:relative;
display:grid;
}

:host([size="compact"]){
--violet-target-size:var(--_target-size-compact);
--violet-control-label-size:var(--_type-label-size-compact);
--violet-control-body-size:var(--_type-body-size-compact);
--violet-control-caption-size:var(--_type-caption-size-compact);
}

:host([size="natural"]){
--violet-target-size:var(--_target-size-natural);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

:host([size="comfortable"]){
--violet-target-size:var(--_target-size-comfortable);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-shell{
position:relative;
display:grid;
}

.control-shell.open{
z-index:var(--_layer-raised);
}

.control-frame{
box-sizing:border-box;
display:flex;
align-items:center;
gap:var(--_space-inline-sm);
inline-size:100%;
block-size:var(--_target-size);
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control-frame:hover{
box-shadow:var(--_field-shadow-hover);
}

.control-frame:focus-within,
.control-shell.open .control-frame{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .control-frame{
border-color:var(--_danger-border);
}

.input{
flex:1 1 auto;
min-inline-size:0;
border:0;
background:transparent;
color:inherit;
font:inherit;
font-size:var(--_control-body-size);
line-height:1;
outline:none;
}

.input::-webkit-calendar-picker-indicator{
display:none;
}

.toggle{
display:inline-grid;
place-items:center;
inline-size:calc(var(--_target-size) * 0.75);
block-size:calc(var(--_target-size) * 0.75);
padding:0;
border:1px solid transparent;
border-radius:var(--_radius-round,9999px);
background:transparent;
color:inherit;
cursor:pointer;
}

.toggle:hover{
background:color-mix(in srgb,var(--_focus-ring) 10%,transparent);
}

.toggle:focus-visible{
outline:none;
border-color:color-mix(in srgb,var(--_focus-ring) 48%,var(--_border-subtle));
box-shadow:0 0 0 2px color-mix(in srgb,var(--_focus-ring) 35%,transparent);
}

.icon{
display:inline-grid;
place-items:center;
}

.icon violet-icon{
--violet-icon-size:max(0.9rem,calc(var(--_target-size) * 0.33));
}

.display{
display:none;
}

.panel{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
z-index:var(--_layer-popover);
inline-size:var(--_panel-inline-size,auto);
max-inline-size:calc(100vw - 8px);
padding:0;
border:0;
overflow:visible;
background:transparent;
color:inherit;

--violet-calendar-background:var(--_surface-floating);
--violet-calendar-shadow:var(--_shadow-floating);
}

.panel[hidden]{
display:none;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

.control-shell.open ~ .supporting,
.control-shell.open ~ .error{
visibility:hidden;
}

@media (forced-colors:active){
.control-frame{
border-color:ButtonText;
}

.control-frame:focus-within,
.control-shell.open .control-frame{
outline:2px solid Highlight;
outline-offset:1px;
}

.toggle:focus-visible{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
border-color:GrayText;
}
}
`,Ib=h`
    <div class="field" part="field" @focusout="${(t,e)=>t.handleFocusOut(e.event)}">
        ${g(t=>!!t.label,h`<label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>`)}
        <div class="${t=>`control-shell${t.open?" open":""}`}" part="control-shell">
            <div class="control-frame" part="control-frame">
                <input
                    id="${t=>t.inputId}"
                    class="input"
                    part="input"
                    type="date"
                    name="${t=>t.name}"
                    min="${t=>t.min}"
                    max="${t=>t.max}"
                    ?disabled="${t=>t.effectiveDisabled}"
                    ?required="${t=>t.required}"
                    aria-describedby="${t=>t.describedBy||null}"
                    aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
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
                role="dialog"
                aria-label="${t=>t.label?`${t.label} calendar`:"Choose date"}"
                popover="manual"
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
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${g(t=>!!t.displayErrorText,h`<p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>`)}
    </div>
`,re=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;#s;#n;constructor(){super(),this.#t="",this.#o=null,this.#i=()=>{this.open&&!this.panelElement?.hidden&&this.#c()},this.#r=!1,this.#s=e=>{let i=e.composedPath().includes(this);this.#r=i,this.open&&!this.panelElement?.hidden&&!i&&this.hide()},this.#n=()=>{this.#r=!1},this.nativeValidationMessage="",this.#e=this.attachInternals(),this.open=!1,this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,this.min="",this.max="",this.locale="",this.size="natural",cr+=1,this.inputId=`violet-date-picker-input-${cr}`,this.supportingId=`violet-date-picker-supporting-${cr}`,this.errorId=`violet-date-picker-error-${cr}`,this.panelId=`violet-date-picker-panel-${cr}`}connectedCallback(){super.connectedCallback(),this.ownerDocument.addEventListener("pointerdown",this.#s,!0),this.ownerDocument.addEventListener("click",this.#n,!0),this.ownerDocument.addEventListener("pointercancel",this.#n,!0),this.ownerDocument.addEventListener("keydown",this.#n,!0),window.addEventListener("resize",this.#i),window.addEventListener("scroll",this.#i,!0),this.#d(),this.#t=this.value,this.#l(),this.#a(!1)}disconnectedCallback(){this.#o?.(),this.#o=null,this.ownerDocument.removeEventListener("pointerdown",this.#s,!0),this.ownerDocument.removeEventListener("click",this.#n,!0),this.ownerDocument.removeEventListener("pointercancel",this.#n,!0),this.ownerDocument.removeEventListener("keydown",this.#n,!0),this.#r=!1,window.removeEventListener("resize",this.#i),window.removeEventListener("scroll",this.#i,!0),super.disconnectedCallback()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get displayValue(){return this.value?Xo(this.locale,this.value):""}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:this.nativeValidationMessage})}valueChanged(){this.#d(),this.#l()}disabledChanged(){this.#l()}requiredChanged(){this.#l()}invalidChanged(){this.#l()}errorTextChanged(){this.#l()}minChanged(){this.#l()}maxChanged(){this.#l()}openChanged(){this.#a(!0)}#a(e){if(!this.$fastController.isConnected)return;let i=this.panelElement;if(!i)return;if(this.shadowRoot?.querySelector(".control-shell")?.classList.toggle("open",this.open),this.#o?.(),this.#o=null,this.open){let r=gn(this),n=s=>{bn(i,s),this.#c()};r&&(this.#o=yn(r,s=>{!this.open||!this.$fastController.isConnected||(s?n(!0):ui(i))})),!r||$i(r)?(n(!1),e&&requestAnimationFrame(()=>{this.open&&!this.panelElement?.hidden&&this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]')?.focus()})):ui(i)}else ui(i);e&&this.$emit("open-change",{open:this.open})}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("change",{value:this.value})}handleInputKeydown(e){return this.effectiveDisabled?!0:e.key==="ArrowDown"&&e.altKey?(e.preventDefault(),this.show(),!1):e.key==="Escape"&&this.open?(e.preventDefault(),this.hide(),!1):!0}handlePanelKeydown(e){return e.key==="Escape"&&this.open?(e.preventDefault(),e.stopPropagation(),this.hide(),this.inputElement?.focus(),!1):!0}handleFocusOut(e){let i=e.relatedTarget;return this.open&&!this.panelElement?.hidden&&!this.#r&&i instanceof Node&&i!==this&&!this.shadowRoot?.contains(i)&&this.hide(),!0}handleCalendarInput(e){e.stopPropagation()}handleCalendarChange(e){e.stopPropagation();let i=e.detail?.value??"";i&&(this.value=i,this.#l(),this.hide(),this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value}),this.inputElement?.focus())}show(){this.effectiveDisabled||(this.open=!0)}hide(){this.open=!1}toggleOpen(){this.open?this.hide():this.show()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#d(!0),this.#l()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get inputElement(){return this.shadowRoot?.querySelector(".input")}get panelElement(){return this.shadowRoot?.querySelector(".panel")}get calendarElement(){return this.shadowRoot?.querySelector("violet-calendar")}#d(e=!1){let i=this.inputElement;i&&(e||i.value!==this.value)&&(i.value=this.value)}#l(){if(this.effectiveDisabled){this.nativeValidationMessage="",this.validationMessageText="",this.#e.setFormValue(null),this.#e.setValidity({});return}let e=this.inputElement,i=this.required&&!this.value,o=(this.errorText??"").trim(),r=this.invalid?o||"Select a valid date.":"",n=this.value?!Fe(this.value):!1,s=this.value&&!n,a=!!(s&&Fe(this.min)&&this.value<this.min),l=!!(s&&Fe(this.max)&&this.value>this.max),d=i?"Please choose a date.":n?"Enter a valid date.":a?`Choose a date on or after ${this.min}.`:l?`Choose a date on or before ${this.max}.`:"";this.nativeValidationMessage=d,this.validationMessageText=r||d,this.#e.setFormValue(this.value||null),this.#e.setValidity({valueMissing:i,customError:!!r,badInput:n,rangeUnderflow:a,rangeOverflow:l},this.validationMessageText,e??void 0)}#c(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".control-frame");if(!e||!i)return;let o=i.getBoundingClientRect(),r=Math.max(o.width,280);e.style.inlineSize=`${r}px`,e.style.left=`${Math.max(4,Math.min(o.left,window.innerWidth-r-4))}px`,e.style.top=`${Math.max(4,Math.min(o.bottom+4,window.innerHeight-320))}px`}};Xs([f],re.prototype,"open",void 0);Xs([f],re.prototype,"validationMessageText",void 0);Xs([f],re.prototype,"nativeValidationMessage",void 0);c({mode:"boolean"})(re.prototype,"open");c(re.prototype,"label");c({attribute:"supporting-text"})(re.prototype,"supportingText");c({attribute:"error-text"})(re.prototype,"errorText");c(re.prototype,"value");c(re.prototype,"name");c({mode:"boolean"})(re.prototype,"required");c({mode:"boolean"})(re.prototype,"disabled");G(re.prototype);c({mode:"boolean"})(re.prototype,"invalid");c(re.prototype,"min");c(re.prototype,"max");c(re.prototype,"locale");c(re.prototype,"size");var vh={name:"violet-date-picker",template:Ib,styles:$b,shadowOptions:{delegatesFocus:!0}};var Ab=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},fo=0,Rb=b`
    ${V}

:host{
position:relative;
display:grid;
}

:host([size="compact"]){
--violet-target-size:var(--_target-size-compact);
--violet-control-label-size:var(--_type-label-size-compact);
--violet-control-body-size:var(--_type-body-size-compact);
--violet-control-caption-size:var(--_type-caption-size-compact);
}

:host([size="natural"]){
--violet-target-size:var(--_target-size-natural);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

:host([size="comfortable"]){
--violet-target-size:var(--_target-size-comfortable);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-shell{
position:relative;
display:grid;
}

.control-shell.open{
z-index:var(--_layer-raised);
}

.trigger{
box-sizing:border-box;
display:grid;
grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-inline-sm);
inline-size:100%;
block-size:var(--_target-size);
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
cursor:pointer;
font-family:inherit;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
text-align:start;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.trigger:hover{
box-shadow:var(--_field-shadow-hover);
}

.trigger:focus-visible,
.control-shell.open .trigger{
outline:none;
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .trigger{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .trigger{
border-color:var(--_danger-border);
}

.segment{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.segment.placeholder{
color:var(--_field-placeholder);
}

.separator{
color:var(--_text-muted);
}

.icon{
display:inline-grid;
place-items:center;
color:var(--_text-muted);
}

.icon violet-icon{
--violet-icon-size:max(0.9rem,calc(var(--_target-size) * 0.33));
}

.panel{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
z-index:var(--_layer-popover);
inline-size:var(--_panel-inline-size,auto);
max-inline-size:calc(100vw - 8px);
padding:0;
border:0;
overflow:visible;
background:transparent;
color:inherit;

--violet-calendar-background:var(--_surface-floating);
--violet-calendar-shadow:var(--_shadow-floating);
}

.panel[hidden]{
display:none;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

.control-shell.open ~ .supporting,
.control-shell.open ~ .error{
visibility:hidden;
}

@media (forced-colors:active){
.trigger{
border-color:ButtonText;
}

.trigger:focus-visible,
.control-shell.open .trigger{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .trigger{
border-color:GrayText;
}
}
`,Db=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`<div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>`)}
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
                aria-invalid="${t=>!t.disabled&&t.invalid?"true":"false"}"
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
                popover="manual"
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
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${g(t=>!!t.displayErrorText,h`<p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>`)}
    </div>
`,me=class extends y{#e=null;#t=()=>{this.open&&!this.panelElement?.hidden&&this.#r()};#o=e=>{!this.open||this.panelElement?.hidden||e.composedPath().includes(this)||this.hide()};constructor(){super(),this.open=!1,this.label="",this.supportingText="",this.errorText="",this.start="",this.end="",this.min="",this.max="",this.locale="",this.required=!1,this.disabled=!1,this.invalid=!1,this.size="natural",fo+=1,this.triggerId=`violet-date-range-picker-trigger-${fo}`,this.labelId=`violet-date-range-picker-label-${fo}`,this.supportingId=`violet-date-range-picker-supporting-${fo}`,this.errorId=`violet-date-range-picker-error-${fo}`,this.panelId=`violet-date-range-picker-panel-${fo}`}connectedCallback(){super.connectedCallback(),this.ownerDocument.addEventListener("pointerdown",this.#o,!0),window.addEventListener("resize",this.#t),window.addEventListener("scroll",this.#t,!0),this.#i(!1)}disconnectedCallback(){this.#e?.(),this.#e=null,this.ownerDocument.removeEventListener("pointerdown",this.#o,!0),window.removeEventListener("resize",this.#t),window.removeEventListener("scroll",this.#t,!0),super.disconnectedCallback()}get value(){return{start:this.start||null,end:this.end||null}}get labelledBy(){return this.label?`${this.labelId} ${this.triggerId}`:this.triggerId}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.disabled,errorText:this.errorText})}get startDisplay(){return this.start?Xo(this.locale,this.start):"Start date"}get endDisplay(){return this.end?Xo(this.locale,this.end):"End date"}openChanged(){this.#i(!0)}#i(e){if(!this.$fastController.isConnected)return;let i=this.panelElement;if(i){if(this.#e?.(),this.#e=null,this.open){let o=gn(this),r=n=>{bn(i,n),this.#r()};o&&(this.#e=yn(o,n=>{!this.open||!this.$fastController.isConnected||(n?r(!0):ui(i))})),!o||$i(o)?(r(!1),e&&requestAnimationFrame(()=>{this.open&&!this.panelElement?.hidden&&this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]')?.focus()})):ui(i)}else ui(i);e&&this.$emit("open-change",{open:this.open})}}toggleOpen(){this.disabled||(this.open?this.hide():this.show())}show(){this.disabled||(this.open=!0)}hide(){this.open=!1}handleTriggerKeydown(e){return this.disabled?!0:e.key==="ArrowDown"||e.key==="Enter"||e.key===" "?(e.preventDefault(),this.show(),!1):e.key==="Escape"&&this.open?(e.preventDefault(),this.hide(),!1):!0}handlePanelKeydown(e){return e.key==="Escape"&&this.open?(e.preventDefault(),e.stopPropagation(),this.hide(),this.shadowRoot?.getElementById(this.triggerId)?.focus(),!1):!0}handleCalendarChange(e){e.stopPropagation(),this.start=e.detail?.start??"",this.end=e.detail?.end??"",this.$emit("input",this.value),this.$emit("change",this.value),this.start&&this.end&&(this.hide(),this.shadowRoot?.getElementById(this.triggerId)?.focus())}checkValidity(){return!(this.invalid||this.required&&(!this.start||!this.end)||this.start&&this.end&&this.start>this.end)}get panelElement(){return this.shadowRoot?.querySelector(".panel")}get calendarElement(){return this.shadowRoot?.querySelector("violet-calendar")}#r(){let e=this.panelElement,i=this.shadowRoot?.querySelector(".trigger");if(!e||!i)return;let o=i.getBoundingClientRect(),r=Math.max(o.width,320);e.style.inlineSize=`${r}px`,e.style.left=`${Math.max(4,Math.min(o.left,window.innerWidth-r-4))}px`,e.style.top=`${Math.max(4,Math.min(o.bottom+4,window.innerHeight-360))}px`}};Ab([f],me.prototype,"open",void 0);c({mode:"boolean"})(me.prototype,"open");c(me.prototype,"label");c({attribute:"supporting-text"})(me.prototype,"supportingText");c({attribute:"error-text"})(me.prototype,"errorText");c(me.prototype,"start");c(me.prototype,"end");c(me.prototype,"min");c(me.prototype,"max");c(me.prototype,"locale");c({mode:"boolean"})(me.prototype,"required");c({mode:"boolean"})(me.prototype,"disabled");c({mode:"boolean"})(me.prototype,"invalid");c(me.prototype,"size");var gh={name:"violet-date-range-picker",template:Db,styles:Rb,shadowOptions:{delegatesFocus:!0}};var Fb=b`
    ${A}

:host{
display:block;
--_divider-color:var(--_border-subtle);
--_divider-thickness:1px;
--_divider-min-block-size:1.5rem;
}

:host([appearance="strong"]){
--_divider-color:color-mix(in srgb,var(--_border-subtle) 45%,var(--_text-secondary));
}

:host([orientation="vertical"]){
display:inline-flex;
align-self:stretch;
}

.rule{
margin:0;
border:0;
background:var(--_divider-color);
color:inherit;
flex:none;
}

.rule.horizontal{
display:block;
inline-size:100%;
block-size:var(--_divider-thickness);
}

.rule.vertical{
display:block;
inline-size:var(--_divider-thickness);
min-block-size:var(--_divider-min-block-size);
block-size:100%;
}

@media (forced-colors:active){
.rule{
forced-color-adjust:none;
background:ButtonText;
}
}
`,Mb=h`
    ${g(t=>t.orientation==="vertical",h`
            <div
                class="rule vertical"
                part="rule"
                role="${t=>t.decorative?"presentation":"separator"}"
                aria-hidden="${t=>t.decorative?"true":"false"}"
                aria-orientation="${t=>t.decorative?null:"vertical"}"
            ></div>
        `)}
    ${g(t=>t.orientation!=="vertical",h`
            <hr class="rule horizontal" part="rule" aria-hidden="${t=>t.decorative?"true":"false"}" />
        `)}
`,Ii=class extends y{constructor(){super(),this.appearance="subtle",this.orientation="horizontal",this.decorative=!1}};c(Ii.prototype,"appearance");c(Ii.prototype,"orientation");c({mode:"boolean"})(Ii.prototype,"decorative");var bh={name:"violet-divider",template:Mb,styles:Fb};var yh=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Vb=b`
    ${A}

:host{
display:block;
--_empty-padding:var(--_space-lg);
--_empty-gap:var(--_space-md);
--_empty-background:transparent;
--_empty-border:transparent;
--_empty-shadow:none;
--_empty-align:center;
}

:host([appearance="subtle"]){
--_empty-background:color-mix(in srgb,var(--_surface-subtle) 60%,var(--_surface-card));
--_empty-border:transparent;
}


:host([appearance="outline"]){
--_empty-background:transparent;
--_empty-border:color-mix(in srgb,var(--violet-color-border-strong,#6b7d6e) 60%,transparent);
}

:host([orientation="horizontal"]){
--_empty-align:start;
}

.root{
box-sizing:border-box;
display:grid;
gap:var(--_empty-gap);
justify-items:var(--_empty-align);
padding:var(--_empty-padding);
border:1px solid var(--_empty-border);
border-radius:var(--_radius-lg);
background:var(--_empty-background);
box-shadow:var(--_empty-shadow);
text-align:var(--_empty-align);
}

:host([appearance="outline"]) .root{
border-style:dashed;
}

:host([orientation="horizontal"]) .root{
grid-template-columns:auto minmax(0,1fr);
align-items:center;
text-align:start;
}

.media{
display:grid;
justify-items:inherit;
min-inline-size:0;
}

.media[hidden]{
display:none;
}

.body{
display:grid;
gap:var(--_space-stack-xs);
min-inline-size:0;
}

.heading,
.message{
justify-self:inherit;
}

.heading[hidden],
.message[hidden],
.actions[hidden]{
display:none;
}

.body-slot::slotted(*){
margin:0;
}

.actions{
display:flex;
flex-wrap:wrap;
gap:var(--_space-sm);
justify-content:inherit;
margin-block-start:var(--_space-stack-sm);
}

@media (forced-colors:active){
.root{
forced-color-adjust:none;
background:Canvas;
border-color:ButtonText;
box-shadow:none;
}
}
`,Ob=h`
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
`,Et=class extends y{constructor(){super(),this.hasMedia=!1,this.hasActions=!1,this.heading="",this.message="",this.appearance="plain",this.orientation="vertical"}handleMediaSlotChange(){this.hasMedia=this.#e('slot[name="media"]')}handleActionsSlotChange(){this.hasActions=this.#e('slot[name="actions"]')}handleDefaultSlotChange(){}#e(e){return(this.shadowRoot?.querySelector(e)?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0)}};yh([f],Et.prototype,"hasMedia",void 0);yh([f],Et.prototype,"hasActions",void 0);c(Et.prototype,"heading");c(Et.prototype,"message");c(Et.prototype,"appearance");c(Et.prototype,"orientation");var xh={name:"violet-empty-state",template:Ob,styles:Vb};var J=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},dr="__violet-file-explorer-root__",hi=class{constructor(e){this.value=e,this.name="",this.expanded=!1,this.expandable=!1,this.children=[]}};J([f],hi.prototype,"value",void 0);J([f],hi.prototype,"name",void 0);J([f],hi.prototype,"expanded",void 0);J([f],hi.prototype,"expandable",void 0);J([f],hi.prototype,"children",void 0);var ur=class{constructor(e,i){this.id=e,this.name=i}};J([f],ur.prototype,"id",void 0);J([f],ur.prototype,"name",void 0);var lt=class{constructor(e){this.id=e,this.name="",this.kind="file",this.meta="",this.icon="",this.selected=!1,this.disabled=!1,this.active=!1}get accessibleName(){return[this.name,this.meta,this.kind==="folder"?"folder":""].filter(Boolean).join(", ")}};J([f],lt.prototype,"id",void 0);J([f],lt.prototype,"name",void 0);J([f],lt.prototype,"kind",void 0);J([f],lt.prototype,"meta",void 0);J([f],lt.prototype,"icon",void 0);J([f],lt.prototype,"selected",void 0);J([f],lt.prototype,"disabled",void 0);J([f],lt.prototype,"active",void 0);var Lb=b`
    ${V}
    ${A}

:host{
display:block;
container-type:inline-size;
block-size:var(--violet-file-explorer-block-size,24rem);
min-inline-size:0;

--_explorer-nav-size:var(--violet-file-explorer-nav-inline-size,14rem);
--_explorer-radius:var(--violet-file-explorer-radius,var(--_radius-lg));
--_explorer-padding:var(--violet-file-explorer-padding,var(--_space-stack-sm));
--_row-radius:var(--violet-file-explorer-row-radius,var(--_radius-md));
--_row-background-hover:var(--violet-file-explorer-row-background-hover,var(--_surface-subtle));
--_row-background-selected:var(--violet-file-explorer-row-background-selected,var(--_surface-hover));
--_row-border-selected:var(--violet-file-explorer-row-border-selected,var(--_border-subtle));
--_danger-text:var(--violet-color-state-danger-foreground,#c42a1a);
}

.explorer{
box-sizing:border-box;
display:grid;
grid-template-rows:auto minmax(0,1fr) auto;
block-size:100%;
min-block-size:0;
border:1px solid var(--_border-subtle);
border-radius:var(--_explorer-radius);
background:var(--_surface-card);
overflow:hidden;
}

.toolbar{
display:flex;
flex-wrap:wrap;
align-items:center;
justify-content:space-between;
gap:var(--_space-inline-md);
padding:var(--_space-stack-xs) var(--_explorer-padding);
border-block-end:1px solid var(--_border-subtle);
min-block-size:var(--_target-size);
}

.actions{
display:flex;
align-items:center;
gap:var(--_space-inline-md);
margin-inline-start:auto;
}

.body{
display:grid;
grid-template-columns:minmax(8rem,var(--_explorer-nav-size)) minmax(0,1fr);
min-block-size:0;
}

violet-tree{
--violet-tree-row-background-selected:var(--_row-background-selected);
--violet-tree-row-background-hover:var(--_row-background-hover);
--violet-tree-row-border-selected:var(--_row-border-selected);
}

.nav{
min-inline-size:0;
min-block-size:0;
overflow:auto;
padding:var(--_space-stack-xs);
border-inline-end:1px solid var(--_border-subtle);
}

.content{
position:relative;
display:flex;
flex-direction:column;
min-inline-size:0;
min-block-size:0;
overflow:auto;
padding:var(--_space-stack-xs);
outline:none;
}

.list{
display:grid;
gap:0;
outline:none;
}

.row{
box-sizing:border-box;
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-inline-md);
min-block-size:var(--_target-size);
padding-block:var(--_space-stack-2xs);
padding-inline:var(--_space-inline-md);
border-radius:var(--_row-radius);
color:var(--_text-primary);
cursor:pointer;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
outline:none;
user-select:none;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard);
}

.row:hover{
background:var(--_row-background-hover);
}

.row[aria-selected="true"]{
background:var(--_row-background-selected);
box-shadow:inset 0 0 0 1px var(--_row-border-selected);
}

.row:focus-visible{
box-shadow:inset 0 0 0 2px var(--_focus-ring);
}

.row[aria-selected="true"]:focus-visible{
box-shadow:
inset 0 0 0 1px var(--_row-border-selected),
inset 0 0 0 3px var(--_focus-ring);
}

.row[aria-disabled="true"]{
color:var(--_text-muted);
cursor:not-allowed;
opacity:0.75;
}

.row-icon{
--violet-icon-size:1.125rem;
color:var(--_text-secondary);
}

.name{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.meta{
color:var(--_text-secondary);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
white-space:nowrap;
}

.state{
display:grid;
flex:1;
place-content:center;
justify-items:center;
gap:var(--_space-stack-sm);
padding:var(--_space-stack-sm);
color:var(--_text-secondary);
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
text-align:center;
}

.state.loading{
display:flex;
flex:none;
align-items:center;
justify-content:center;
gap:var(--_space-inline-md);
}

.state.loading:only-child{
flex:1;
}

.error-message{
margin:0;
color:var(--_danger-text);
}

.footer{
padding:var(--_space-stack-xs) var(--_explorer-padding);
border-block-start:1px solid var(--_border-subtle);
}

.footer[hidden]{
display:none;
}

.sr-only{
position:absolute;
inline-size:1px;
block-size:1px;
margin:-1px;
padding:0;
overflow:hidden;
clip-path:inset(50%);
white-space:nowrap;
border:0;
}

@container (max-width:34rem){
.body{
grid-template-columns:minmax(0,1fr);
grid-template-rows:minmax(0,auto) minmax(0,1fr);
}

.nav{
max-block-size:8rem;
border-inline-end:0;
border-block-end:1px solid var(--_border-subtle);
}
}

@media (forced-colors:active){
.explorer{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:CanvasText;
}

.row{
forced-color-adjust:none;
color:CanvasText;
}

.row[aria-selected="true"]{
background:Canvas;
box-shadow:inset 0 0 0 2px Highlight;
}

.row:focus-visible{
box-shadow:inset 0 0 0 2px Highlight;
outline:2px solid Highlight;
}
}
`,wh=h`
    <violet-tree-item
        value="${t=>t.value}"
        ?expanded="${t=>t.expanded}"
        ?expandable="${t=>t.expandable}"
    >
        <violet-icon slot="start" icon="system/folder" decorative></violet-icon>
        ${t=>t.name}
        ${N(t=>t.children,(t,e)=>wh,{recycle:!1})}
    </violet-tree-item>
`,Pb=h`
    <violet-breadcrumb-item
        href="#"
        data-folder-id="${t=>t.id}"
        @click="${(t,e)=>e.parent.handleCrumbClick(t,e.event)}"
    >
        ${t=>t.name}
    </violet-breadcrumb-item>
`,Bb=h`
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
`,Nb=h`
    <div class="explorer" part="explorer" role="group" aria-label="${t=>t.label||"File explorer"}">
        <div class="toolbar" part="toolbar">
            <violet-breadcrumb part="breadcrumb" label="Folder path">
                ${N(t=>t.crumbs,Pb,{recycle:!1})}
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
                    ${N(t=>t.folderTree,wh,{recycle:!1})}
                </violet-tree>
            </div>
            <div
                class="content"
                part="content"
                tabindex="-1"
                aria-busy="${t=>t.isLoading?"true":"false"}"
            >
                ${g(t=>t.isLoading,h`
                        <div class="state loading" part="loading-state" role="status">
                            <violet-spinner size="sm" label="Loading folder contents"></violet-spinner>
                            <span>Loading…</span>
                        </div>
                    `)}
                ${g(t=>!!t.loadError,h`
                        <div class="state" part="error-state" role="alert">
                            <p class="error-message" part="error-text">${t=>t.loadError}</p>
                            <violet-button appearance="secondary" @click="${t=>t.handleRetry()}">
                                Try again
                            </violet-button>
                        </div>
                    `)}
                ${g(t=>t.isEmpty,h`
                        <div class="state" part="empty-state">
                            <slot name="empty">
                                <violet-empty-state
                                    heading="This folder is empty"
                                    appearance="plain"
                                ></violet-empty-state>
                            </slot>
                        </div>
                    `)}
                ${g(t=>t.rows.length>0&&!t.loadError,h`
                        <div
                            class="list"
                            part="list"
                            role="listbox"
                            aria-label="${t=>t.listLabel}"
                            aria-multiselectable="${t=>t.selectionMode==="multiple"?"true":null}"
                            @keydown="${(t,e)=>t.handleListKeydown(e.event)}"
                            @focusin="${(t,e)=>t.handleListFocusIn(e.event)}"
                        >
                            ${N(t=>t.rows,Bb,{recycle:!1})}
                        </div>
                    `)}
            </div>
        </div>
        <div class="footer" part="footer" ?hidden="${t=>!t.hasFooter}">
            <slot name="footer" @slotchange="${(t,e)=>t.handleFooterSlotChange(e.event)}"></slot>
        </div>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${t=>t.statusMessage}</div>
    </div>
`,ne=class extends y{#e=!1;#t=new Set([""]);#o=new Set;#i=new Map;#r=new Map;#s=new Map;#n="";#a="";#d=null;#l="";#c=!1;constructor(){super(),this.items=[],this.selectedIds=[],this.crumbs=[],this.folderTree=[],this.rows=[],this.statusMessage="",this.isLoading=!1,this.isEmpty=!1,this.treeValue=dr,this.listLabel="Folder contents",this.hasFooter=!1,this.currentFolderId="",this.rootLabel="Files",this.selectionMode="single",this.busy=!1,this.loadError="",this.label=""}connectedCallback(){super.connectedCallback(),this.#e=!0,this.#b(),this.#m(this.currentFolderId,"navigate")}disconnectedCallback(){this.#e=!1,super.disconnectedCallback()}itemsChanged(){for(let e of[...this.#o])this.#u(e)?.loaded!==!1&&this.#o.delete(e);this.#v()}selectedIdsChanged(){this.#v()}currentFolderIdChanged(){this.#e&&(this.#h(this.currentFolderId),this.#v(),this.#m(this.currentFolderId,"navigate"))}rootLabelChanged(){this.#v()}selectionModeChanged(){this.#v()}busyChanged(){this.#v()}loadErrorChanged(){this.#v()}focusList(){this.#B()}handleFooterSlotChange(e){this.hasFooter=e.target.assignedNodes().length>0}handleCrumbClick(e,i){this.#w(e.id,{kind:"first"})}handleTreeChange(e){e.stopPropagation();let i=e.detail?.value;typeof i=="string"&&this.#w(i===dr?"":i,null)}handleTreeExpandedChange(e){e.stopPropagation();let{value:i,expanded:o}=e.detail??{};if(typeof i!="string")return;let r=i===dr?"":i;o?(this.#t.add(r),this.#m(r,"expand")):this.#t.delete(r);let n=this.#r.get(r);n&&(n.expanded=o)}handleRetry(){this.#o.delete(this.currentFolderId),this.#g(this.currentFolderId,"retry")}handleRowClick(e,i){if(!e.disabled){if(this.#P(e.id),this.selectionMode==="none"){this.#I(e.id);return}if(this.selectionMode==="multiple"&&i.shiftKey&&this.#a){this.#y(this.#a,e.id);return}if(this.selectionMode==="multiple"&&(i.ctrlKey||i.metaKey)){this.#S(e.id);return}this.#a=e.id,this.#k([e.id])}}handleRowDoubleClick(e){e.disabled||this.selectionMode==="none"||this.#I(e.id)}handleListFocusIn(e){let i=this.#R(e);return i&&this.#P(i),!0}handleListKeydown(e){let i=this.#R(e),o=this.rows,r=o.findIndex(l=>l.id===i);if(r<0||e.isComposing)return!0;let n=o[r],s=e.shiftKey&&this.selectionMode==="multiple",a=l=>{let d=o[Math.max(0,Math.min(o.length-1,l))];e.preventDefault(),d&&(s&&(this.#a||=n.id,this.#y(this.#a,d.id)),this.#G(d.id))};switch(e.key){case"ArrowDown":a(r+1);break;case"ArrowUp":a(r-1);break;case"Home":a(0);break;case"End":a(o.length-1);break;case"Enter":e.preventDefault(),n.disabled||this.#I(n.id);break;case" ":e.preventDefault(),!n.disabled&&this.selectionMode!=="none"&&(this.#a=n.id,this.selectionMode==="multiple"?this.#S(n.id):this.#k([n.id]));break;case"Escape":this.selectedIds.length>0&&this.selectionMode!=="none"&&(e.preventDefault(),this.#k([]));break;case"Backspace":this.#O(e);break;case"ArrowLeft":e.altKey&&this.#O(e);break;case"a":case"A":(e.ctrlKey||e.metaKey)&&this.selectionMode==="multiple"&&(e.preventDefault(),this.#k(o.filter(l=>!l.disabled).map(l=>l.id)));break;default:break}return!0}#u(e){return this.items.find(i=>i.id===e)}#p(e){return e.parentId??""}#f(e){let i=[],o=new Set,r=e;for(;r&&!o.has(r);){o.add(r),i.unshift(r);let n=this.#u(r);if(!n)break;r=this.#p(n)}return i}#h(e){this.#t.add("");for(let i of this.#f(e).slice(0,-1))this.#t.add(i)}#m(e,i){if(!e||this.#o.has(e))return;let o=this.#u(e);o?.kind==="folder"&&o.loaded===!1&&(this.#o.add(e),this.#g(e,i))}#g(e,i){this.$emit("folder-request",{folderId:e||null,reason:i})}#v(){!this.#e||this.#c||(this.#c=!0,queueMicrotask(()=>{this.#c=!1,this.#e&&this.#b()}))}#b(){let e=this.currentFolderId??"",i=this.#T(),o=this.#n,r=this.rows.findIndex(n=>n.id===o);this.#_(e),this.#E(e),this.#$(e),this.#C(e),this.#N(i,r,o)}#_(e){let i=[this.#z("",this.rootLabel||"Files")];for(let o of this.#f(e))i.push(this.#z(o,this.#u(o)?.name??o));this.crumbs=i}#z(e,i){let o=this.#s.get(e);return o||(o=new ur(e,i),this.#s.set(e,o)),o.name=i,o}#E(e){let i=this.items.filter(s=>s.kind==="folder"),o=new Map;for(let s of i){let a=this.#p(s),l=o.get(a)??[];l.push(s),o.set(a,l)}let r=new Set,n=(s,a)=>{let l=this.#r.get(s);l||(l=new hi(s===""?dr:s),this.#r.set(s,l));let d=s?this.#u(s):void 0,u=r.has(s)?[]:o.get(s)??[];return r.add(s),l.name=a,l.expandable=d?.loaded===!1,l.expanded=this.#t.has(s),l.children=u.map(p=>n(p.id,p.name)),r.delete(s),l};this.folderTree=[n("",this.rootLabel||"Files")],this.treeValue=e===""?dr:e,M.next().then(()=>{let s=this.shadowRoot?.querySelector("violet-tree");s&&(s.value=this.treeValue,s.handleSlotChange())})}#$(e){let i=new Set(this.selectedIds),o=this.items.filter(a=>this.#p(a)===e),r=o.map(a=>{let l=this.#i.get(a.id);return l||(l=new lt(a.id),this.#i.set(a.id,l)),l.name=a.name,l.kind=a.kind,l.meta=a.meta??"",l.icon=a.icon||(a.kind==="folder"?"system/folder":"system/document"),l.disabled=!!a.disabled,l.selected=this.selectionMode!=="none"&&i.has(a.id),l});for(let a of[...this.#i.keys()])o.some(l=>l.id===a)||this.#i.delete(a);r.some(a=>a.id===this.#n)||(this.#n=(r.find(a=>a.selected)??r[0])?.id??"");for(let a of r)a.active=a.id===this.#n;let n=e?this.#u(e):void 0,s=n?.kind==="folder"&&n.loaded===!1;this.isLoading=(this.busy||s)&&!this.loadError,this.isEmpty=r.length===0&&!this.isLoading&&!this.loadError,this.listLabel=`Contents of ${n?.name??(this.rootLabel||"Files")}`,this.rows=r}#C(e){let i=e?this.#u(e)?.name??e:this.rootLabel||"Files",o;if(this.loadError)o=`${i}: ${this.loadError}`;else if(this.isLoading)o=`Loading ${i}`;else if(this.isEmpty)o=`${i} is empty`;else{let r=this.rows.length;o=`${i}: ${r} ${r===1?"item":"items"}`}o!==this.#l&&(this.#l=o,this.statusMessage=o)}#k(e){let i=this.selectionMode==="single"?e.slice(-1):e,o=this.selectedIds;i.length===o.length&&i.every((r,n)=>r===o[n])||(this.selectedIds=i,this.$emit("selection-change",{selectedIds:i,items:i.map(r=>this.#u(r)).filter(r=>!!r)}))}#S(e){let i=this.selectedIds;this.#a=e,this.#k(i.includes(e)?i.filter(o=>o!==e):[...i,e])}#y(e,i){let o=this.rows,r=o.findIndex(l=>l.id===e),n=o.findIndex(l=>l.id===i);if(r<0||n<0)return;let[s,a]=r<=n?[r,n]:[n,r];this.#k(o.slice(s,a+1).filter(l=>!l.disabled).map(l=>l.id))}#I(e){let i=this.#u(e);if(!i||i.disabled)return;this.$emit("item-activate",{id:i.id,kind:i.kind,item:i})!==!1&&i.kind==="folder"&&this.#w(i.id,{kind:"first"})}#w(e,i){if(e===this.currentFolderId){i&&(this.#d=i,this.#v());return}this.selectedIds.length>0&&this.#k([]),this.#d=i,this.#a="",this.#n="",this.currentFolderId=e,this.$emit("folder-change",{folderId:e||null,path:this.#f(e)})}#O(e){let i=this.currentFolderId;if(!i)return;e.preventDefault();let o=this.#u(i);this.#w(o?this.#p(o):"",{kind:"id",id:i})}#L(){return this.shadowRoot?.querySelector(".list")??null}#q(e){let i=this.#L();return i?Array.from(i.querySelectorAll("[data-item-id]")).find(o=>o.dataset.itemId===e)??null:null}#R(e){for(let i of e.composedPath())if(i instanceof HTMLElement&&i.dataset.itemId!==void 0)return i.dataset.itemId;return""}#T(){let e=this.#L(),i=this.shadowRoot?.activeElement??null;return!!(e&&i&&e.contains(i))}#P(e){this.#n=e;for(let i of this.rows)i.active=i.id===e}#G(e){this.#P(e),this.#q(e)?.focus()}#B(){M.next().then(()=>{let e=this.#q(this.#n);if(e){e.focus();return}this.shadowRoot?.querySelector(".content")?.focus()})}#N(e,i,o){let r=this.#d;if(this.isLoading||(this.#d=null),r){let n=this.rows,s=r.kind==="id"?n.find(a=>a.id===r.id)??n[0]:n[0];s&&this.#P(s.id),this.isLoading?M.next().then(()=>this.shadowRoot?.querySelector(".content")?.focus()):this.#B();return}if(e&&!this.rows.some(n=>n.id===o)){let n=this.rows[Math.min(Math.max(i,0),this.rows.length-1)];n&&this.#P(n.id),this.#B();return}e&&this.#B()}};J([f],ne.prototype,"items",void 0);J([f],ne.prototype,"selectedIds",void 0);J([f],ne.prototype,"crumbs",void 0);J([f],ne.prototype,"folderTree",void 0);J([f],ne.prototype,"rows",void 0);J([f],ne.prototype,"statusMessage",void 0);J([f],ne.prototype,"isLoading",void 0);J([f],ne.prototype,"isEmpty",void 0);J([f],ne.prototype,"treeValue",void 0);J([f],ne.prototype,"listLabel",void 0);J([f],ne.prototype,"hasFooter",void 0);c({attribute:"current-folder-id"})(ne.prototype,"currentFolderId");c({attribute:"root-label"})(ne.prototype,"rootLabel");c({attribute:"selection-mode"})(ne.prototype,"selectionMode");c({mode:"boolean"})(ne.prototype,"busy");c({attribute:"load-error"})(ne.prototype,"loadError");c(ne.prototype,"label");var _h={name:"violet-file-explorer",template:Nb,styles:Lb};var Hb=b`
    ${V}

:host{
display:grid;
--violet-target-size:var(--_target-size-natural);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
--_upload-surface:var(--_field-background);
--_upload-surface-hover:color-mix(in srgb,var(--_field-background) 76%,var(--_surface-subtle));
--_upload-surface-active:color-mix(in srgb,var(--_focus-ring) 10%,var(--_field-background));
--_upload-border:var(--_field-border);
--_upload-gap:var(--_space-stack-sm);
--_upload-radius:calc(var(--_radius-md) * 1.5);
--_upload-space-2xs:var(--_space-stack-2xs);
--_upload-space-sm:var(--_space-inline-sm);
--_upload-space-md:calc(var(--_space-inline-md) * 1.5);
--_upload-space-lg:calc(var(--_space-inline-md) * 2.5);
--_upload-stack-md:calc(var(--_space-stack-sm) * 1.5);
--_upload-stack-lg:calc(var(--_space-stack-sm) * 2);
--_upload-padding:clamp(var(--_upload-space-md),2vw,var(--_upload-space-lg));
--_upload-title-size:var(--_control-body-size);
--_upload-summary-size:var(--_control-caption-size);
--_upload-icon-size:max(1rem,calc(var(--_target-size) * 0.4));
color:var(--violet-color-text-primary,#181b1a);
}

:host([size="compact"]){
--violet-target-size:var(--_target-size-compact);
--violet-control-label-size:var(--_type-label-size-compact);
--violet-control-body-size:var(--_type-body-size-compact);
--violet-control-caption-size:var(--_type-caption-size-compact);
}

:host([size="natural"]){
--violet-target-size:var(--_target-size-natural);
}

:host([size="comfortable"]){
--violet-target-size:var(--_target-size-comfortable);
}

.field{
display:grid;
gap:var(--_space-stack-sm);
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin:0;
}

.surface{
box-sizing:border-box;
display:grid;
gap:var(--_upload-stack-md);
inline-size:100%;
padding:var(--_upload-padding);
border:1px solid var(--_upload-border);
border-radius:var(--_upload-radius);
background:var(--_upload-surface);
box-shadow:var(--_shadow-control);
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard),
background-color var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

.surface:hover{
border-color:var(--_field-border-hover);
background:var(--_upload-surface-hover);
}

.surface:focus-within{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
transform:translateY(calc(var(--_space-inline-sm) / -4));
}

:host([invalid]) .surface,
:host([data-invalid]) .surface{
border-color:var(--_danger-border);
}

:host([disabled]) .surface,
:host(:disabled) .surface{
cursor:not-allowed;
transform:none;
box-shadow:none;
}

.surface.dropzone{
min-block-size:calc(var(--_target-size) * 4.15);
border-style:dashed;
align-content:center;
justify-items:stretch;
padding:max(var(--_upload-space-lg),calc(var(--_target-size) * 0.5));
}

:host([data-drag-active]) .surface.dropzone{
border-color:var(--_field-border-focus);
background:var(--_upload-surface-active);
box-shadow:var(--_field-shadow-focus);
}

.button-layout{
display:grid;
grid-template-columns:auto minmax(0,1fr);
align-items:center;
gap:var(--_upload-space-lg);
min-block-size:calc(var(--_target-size) * 1.45);
}

.dropzone-layout{
display:grid;
grid-template-columns:auto minmax(0,1fr);
column-gap:var(--_upload-space-lg);
row-gap:var(--_upload-stack-md);
align-items:start;
min-inline-size:0;
min-block-size:100%;
}

.browse-button{
align-self:center;
}

.browse-button::part(control){
min-inline-size:max-content;
}

.button-copy{
align-content:center;
min-inline-size:0;
}

.dropzone-copy,
.button-copy,
.selection,
.file-copy{
display:grid;
min-inline-size:0;
}

.leading-icon{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:calc(var(--_target-size) * 0.95);
block-size:calc(var(--_target-size) * 0.95);
border-radius:calc(var(--_radius-md) * 1.25);
background:color-mix(in srgb,var(--_focus-ring) 10%,var(--_surface-subtle));
color:var(--_text-secondary);
flex:0 0 auto;
}

.leading-icon violet-icon{
--violet-icon-size:var(--_upload-icon-size);
color:currentColor;
}

.trigger-copy,
.dropzone-title{
margin:0;
color:var(--violet-color-text-primary,#181b1a);
font-size:var(--_upload-title-size);
line-height:1.25;
font-weight:600;
}

.summary,
.dropzone-message,
.selection-summary,
.meta,
.supporting,
.error{
margin:0;
color:var(--_text-muted);
font-size:var(--_upload-summary-size);
line-height:var(--_type-caption-line);
}

.button-copy{
gap:var(--_space-stack-2xs);
}

.dropzone-copy{
gap:var(--_space-stack-xs);
align-content:start;
max-inline-size:34rem;
padding-block-start:var(--_upload-space-2xs);
}

.dropzone-actions{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:var(--_upload-space-md);
grid-column:2;
}

.native-input{
position:absolute;
inline-size:1px;
block-size:1px;
margin:-1px;
padding:0;
overflow:hidden;
opacity:0;
pointer-events:none;
clip:rect(0 0 0 0);
clip-path:inset(50%);
white-space:nowrap;
border:0;
}

.selection{
gap:var(--_space-stack-xs);
}

.selection[hidden],
.supporting[hidden],
.error[hidden]{
display:none;
}

.file-list{
display:grid;
gap:var(--_upload-stack-md);
margin:0;
padding:0;
list-style:none;
}

.file-item{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:start;
gap:var(--_upload-space-md);
padding:var(--_upload-space-md) var(--_upload-space-lg);
border:1px solid var(--_border-subtle);
border-radius:calc(var(--_radius-md) * 1.25);
background:color-mix(in srgb,var(--_surface-subtle) 45%,var(--_surface-page));
box-shadow:var(--_shadow-control);
}

.file-item-icon{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:calc(var(--_target-size) * 0.8);
block-size:calc(var(--_target-size) * 0.8);
border-radius:calc(var(--_radius-md) * 1.15);
background:color-mix(in srgb,var(--_focus-ring) 8%,var(--_surface-page));
color:var(--_text-secondary);
}

.file-item-icon violet-icon{
--violet-icon-size:var(--_upload-icon-size);
color:currentColor;
}

.file-copy{
gap:2px;
}

.filename{
margin:0;
color:var(--violet-color-text-primary,#181b1a);
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
font-weight:500;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.remove-button{
align-self:center;
}

@media (max-width:40rem){
.button-layout,
.dropzone-layout{
grid-template-columns:minmax(0,1fr);
}

.dropzone-actions{
grid-column:auto;
}

.button-copy,
.dropzone-copy{
max-inline-size:none;
}
}

.error{
color:var(--_danger-text);
}

@media (forced-colors:active){
.surface,
.file-item{
forced-color-adjust:none;
background:Canvas;
border-color:ButtonText;
box-shadow:none;
color:CanvasText;
}


:is(.surface,.file-item) :where(p,span,strong,small){
color:CanvasText;
}


:is(.surface,.file-item) :is(violet-button,violet-icon-button){
forced-color-adjust:auto;
}

.surface:hover{
border-color:ButtonText;
background:Canvas;
}

.surface:focus-within{
border-color:Highlight;
box-shadow:none;
}

:host([invalid]) .surface,
:host([data-invalid]) .surface{
border-color:LinkText;
}

:host([disabled]) .surface,
:host(:disabled) .surface{
border-color:GrayText;
}

:host([data-drag-active]) .surface.dropzone{
background:Canvas;
border-color:Highlight;
box-shadow:none;
outline:2px solid Highlight;
}

.leading-icon,
.file-item-icon{
background:Canvas;
color:ButtonText;
}

.error{
color:LinkText;
}
}
`,jb=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
            ${g(t=>t.appearance==="button",h`
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

            ${g(t=>t.appearance==="dropzone",h`
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
                ${N(t=>t.fileItems,h`
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
        ${g(t=>t.showErrorText,h`
                <p class="error" part="error-message" id="${t=>t.errorId}" role="alert">
                    ${t=>t.effectiveErrorText}
                </p>
            `)}
    </div>
`,mo=0,se=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;constructor(){super(),this.#e=this.attachInternals(),mo+=1,this.inputId=`violet-file-upload-input-${mo}`,this.labelId=`violet-file-upload-label-${mo}`,this.supportingId=`violet-file-upload-supporting-${mo}`,this.errorId=`violet-file-upload-error-${mo}`,this.summaryId=`violet-file-upload-summary-${mo}`,this.#t=[],this.#o=0,this.#i="",this.#r=!1,this.label="",this.supportingText="",this.errorText="",this.dragActive=!1,this.files=[],this.customValidationMessage="",this.appearance="button",this.size="natural",this.accept="",this.name="",this.disabled=!1,this.required=!1,this.invalid=!1,this.multiple=!1,this.maxFiles="",this.maxFileSize="",Ir(),ii(),We()}connectedCallback(){super.connectedCallback(),this.#t=[...this.files],this.#f(),this.#h(),M.enqueue(()=>this.#h())}filesChanged(){this.#f(),this.#h()}disabledChanged(){this.#f(),this.#h()}requiredChanged(){this.#h()}invalidChanged(){this.invalid||(this.customValidationMessage="",this.#r=!1),this.#f(),this.#h()}errorTextChanged(){this.#h()}customValidationMessageChanged(){this.#f(),this.#h()}dragActiveChanged(){this.#f()}multipleChanged(){if(!this.multiple&&this.files.length>1){this.files=this.files.slice(0,1);return}this.#h()}formResetCallback(){this.files=[...this.#t],this.customValidationMessage="",this.#r&&(this.#r=!1,this.invalid=!1),this.dragActive=!1,this.#i="",this.#v()}focus(e){this.shadowRoot?.querySelector('[part~="browse-button"]')?.focus(e)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get value(){return""}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}setFiles(e){let i=[...e],o=this.#l(i);return o?(this.customValidationMessage=o,this.invalid||(this.#r=!0,this.invalid=!0),!1):(this.customValidationMessage="",this.#r&&(this.#r=!1,this.invalid=!1),this.#i=this.#d(i),this.files=i,this.#v(),this.$emit("input",{files:[...this.files]}),this.$emit("change",{files:[...this.files]}),!0)}clearFiles(){this.files=[],this.customValidationMessage="",this.#r&&(this.#r=!1,this.invalid=!1),this.#i="",this.#v(),this.$emit("input",{files:[]}),this.$emit("change",{files:[]})}removeFileAt(e){let i=this.files[e];i&&(this.files=this.files.filter((o,r)=>r!==e),this.customValidationMessage="",this.#r&&(this.#r=!1,this.invalid=!1),this.#i=this.#d(this.files),this.#v(),this.$emit("remove",{file:i,index:e,files:[...this.files]}),this.$emit("input",{files:[...this.files]}),this.$emit("change",{files:[...this.files]}))}handleInput(e){e.stopPropagation();let i=e.currentTarget,o=Array.from(i?.files??[]);this.#i=this.#d(o)}handleCommit(e){e.stopPropagation(),this.handleInputChange(e)}handleBrowseButtonClick(e){e.preventDefault(),e.stopPropagation(),this.openPicker()}handleSurfaceClick(e){if(this.effectiveDisabled||this.appearance!=="dropzone")return;e.composedPath().some(r=>r instanceof HTMLElement?r.tagName==="BUTTON"||r.tagName==="VIOLET-BUTTON"||r.tagName==="VIOLET-ICON-BUTTON":!1)||this.openPicker()}handleInputChange(e){let i=e.currentTarget,o=Array.from(i?.files??[]);this.#s(o)}handleDragEnter(e){this.#g(e)&&(e.preventDefault(),this.#o+=1,this.dragActive=!0)}handleDragOver(e){this.#g(e)&&(e.preventDefault(),e.dataTransfer&&(e.dataTransfer.dropEffect="copy"),this.dragActive=!0)}handleDragLeave(e){this.appearance!=="dropzone"||this.effectiveDisabled||(e.preventDefault(),this.#o=Math.max(0,this.#o-1),this.#o===0&&(this.dragActive=!1))}handleDrop(e){if(!this.#g(e))return;e.preventDefault(),this.dragActive=!1,this.#o=0;let i=Array.from(e.dataTransfer?.files??[]);this.#s(i)}openPicker(){if(this.effectiveDisabled)return;this.shadowRoot?.getElementById(this.inputId)?.click()}get hasFiles(){return T.trackVolatile(),this.files.length>0}get fileItems(){return T.trackVolatile(),this.files.map((e,i)=>({file:e,index:i,key:`${e.name}:${e.size}:${e.lastModified}:${e.type}:${i}`,meta:this.formatFileMeta(e)}))}get browseButtonLabel(){return T.trackVolatile(),!this.multiple&&this.hasFiles?"Replace file":this.multiple?"Browse files":"Browse file"}get buttonTitle(){return T.trackVolatile(),this.hasFiles?this.multiple?"Add or replace selected files":"Replace the selected file":this.multiple?"Select files to upload":"Select a file to upload"}get summaryText(){return T.trackVolatile(),this.hasFiles?this.files.length===1?this.files[0].name:`${this.files.length} files selected`:this.multiple?"No files selected yet.":"No file selected yet."}get dropzoneTitle(){return T.trackVolatile(),this.dragActive?this.multiple?"Drop files to add them":"Drop a file to select it":this.multiple?"Drop files here":"Drop a file here"}get dropzoneMessage(){return T.trackVolatile(),this.hasFiles?this.summaryText:this.multiple?"Or browse from your device to select multiple files.":"Or browse from your device to select one file."}get selectionSummaryText(){return T.trackVolatile(),this.hasFiles?this.files.length===1?"Selected file":`${this.files.length} selected files`:""}get triggerAriaLabel(){return T.trackVolatile(),this.label?`${this.label}: ${this.browseButtonLabel}`:this.browseButtonLabel}get describedBy(){T.trackVolatile();let e=[this.summaryId];return this.showErrorText?e.push(this.errorId):this.supportingText&&e.push(this.supportingId),e.join(" ")||null}get errorMessageId(){return T.trackVolatile(),this.showErrorText?this.errorId:null}get displayErrorText(){return this.effectiveErrorText}get effectiveErrorText(){T.trackVolatile();let e=(this.customValidationMessage??"").trim();return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:e||this.errorText,fallbackValidationMessage:this.errorText})}get showErrorText(){return T.trackVolatile(),!!this.effectiveErrorText}get showSupportingText(){return T.trackVolatile(),!!this.supportingText&&!this.showErrorText}formatFileMeta(e){let i=[this.#m(e.size)];return e.type&&i.push(e.type),i.join(" \u2022 ")}#s(e){let i=this.#d(e);if(i===this.#i&&i===this.#d(this.files))return;this.#i=i;let o=this.multiple?this.#n(this.files,e):e.slice(0,1);this.setFiles(o)}#n(e,i){let o=[...e],r=new Set(e.map(n=>this.#a(n)));for(let n of i){let s=this.#a(n);r.has(s)||(r.add(s),o.push(n))}return o}#a(e){return`${e.name}:${e.size}:${e.type}:${e.lastModified}`}#d(e){return e.map(i=>this.#a(i)).join("|")}#l(e){if(!this.multiple&&e.length>1)return"Only one file can be selected.";let i=this.#u;if(i>0&&e.length>i)return i===1?"Only one file can be selected.":`Select no more than ${i} files.`;let o=this.#p;if(o>0){let r=e.find(n=>n.size>o);if(r)return`${r.name} exceeds the ${this.#m(o)} limit.`}if(this.accept.trim()){let r=e.find(n=>!this.#c(n));if(r)return`${r.name} does not match the accepted file types.`}return""}#c(e){let i=this.accept.split(",").map(n=>n.trim().toLowerCase()).filter(Boolean);if(i.length===0)return!0;let o=e.name.toLowerCase(),r=e.type.toLowerCase();return i.some(n=>{if(n.startsWith("."))return o.endsWith(n);if(n.endsWith("/*")){let s=n.slice(0,-1);return r.startsWith(s)}return r===n})}get#u(){let e=Number.parseInt(this.maxFiles,10);return Number.isFinite(e)&&e>0?e:0}get#p(){let e=Number.parseInt(this.maxFileSize,10);return Number.isFinite(e)&&e>0?e:0}#f(){this.toggleAttribute("data-invalid",!this.effectiveDisabled&&this.invalid),this.toggleAttribute("data-drag-active",this.dragActive)}#h(){if(!this.$fastController.isConnected)return;if(this.effectiveDisabled){this.#e.ariaInvalid="false",this.#e.setValidity({}),this.#e.setFormValue(null);return}let e=this.files??[],i=this.required&&e.length===0,o=this.invalid,r=this.effectiveErrorText||(this.invalid?"Invalid file selection.":"")||(i?"Select a file to continue.":""),s=this.shadowRoot?.querySelector('[part~="browse-button"]')?.shadowRoot?.querySelector("button")??this.shadowRoot?.querySelector("input");if(this.#e.ariaInvalid=this.invalid||this.customValidationMessage?"true":"false",this.#e.setValidity({valueMissing:i,customError:o},r||void 0,s??void 0),this.effectiveDisabled||e.length===0||!this.name){this.#e.setFormValue(null);return}let a=new FormData;for(let l of e)a.append(this.name,l);this.#e.setFormValue(a)}#m(e){return e<1024?`${e} B`:e<1024*1024?`${Math.round(e/102.4)/10} KB`:`${Math.round(e/104857.6)/10} MB`}#g(e){if(this.appearance!=="dropzone"||this.effectiveDisabled)return!1;let i=e.dataTransfer?.types;return i?Array.from(i).includes("Files"):!0}#v(){let e=this.shadowRoot?.getElementById(this.inputId);e&&(e.value="")}};c(se.prototype,"label");c({attribute:"supporting-text"})(se.prototype,"supportingText");c({attribute:"error-text"})(se.prototype,"errorText");c(se.prototype,"appearance");c(se.prototype,"size");c(se.prototype,"accept");c(se.prototype,"name");c({mode:"boolean"})(se.prototype,"disabled");G(se.prototype);c({mode:"boolean"})(se.prototype,"required");c({mode:"boolean"})(se.prototype,"invalid");c({mode:"boolean"})(se.prototype,"multiple");c({attribute:"max-files"})(se.prototype,"maxFiles");c({attribute:"max-file-size"})(se.prototype,"maxFileSize");f(se.prototype,"files");f(se.prototype,"customValidationMessage");f(se.prototype,"dragActive");var kh={name:"violet-file-upload",template:jb,styles:Hb};var Ch=b`
  ${A}

:host{
display:block;
min-block-size:0;
block-size:100%;
container-type:inline-size;

--_gantt-name-width:var(--violet-gantt-name-column-width,16rem);
--_gantt-row-height:64px;
--_gantt-header-height:52px;
--_gantt-work:var(--violet-gantt-work-background,#526b4e);
--_gantt-work-text:var(--violet-gantt-work-foreground,#ffffff);
--_gantt-window:var(--violet-gantt-window-background,#dde7da);
--_gantt-window-text:var(--violet-gantt-window-foreground,#253823);
--_gantt-actual:var(--violet-gantt-actual-border,#186f83);
--_gantt-advisory:var(--violet-gantt-advisory-border,#9a6700);
--_gantt-selection:var(--violet-gantt-selection-ring,#4b67b0);
--_gantt-axis-size:var(--violet-type-label-size,13px);
--_gantt-axis-line:var(--violet-type-label-line,16px);
--_gantt-content-size:var(--violet-control-type-size,13px);
--_gantt-content-line:var(--violet-type-label-line,16px);
--_gantt-type-weight:var(--violet-type-label-weight,500);
--_gantt-expander-width:24px;
--_gantt-tree-gap:calc(var(--_space-sm) / 2);
}

:host([density="compact"]){
--_gantt-row-height:36px;
}

:host([density="comfortable"]){
--_gantt-row-height:76px;
}

.root{
display:grid;
grid-template-rows:auto minmax(0,1fr);
block-size:100%;
min-block-size:0;
overflow:hidden;
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_surface-card);
color:var(--_text-primary);
--_gantt-name-width:var(--violet-gantt-name-column-width,16rem);
}

.toolbar[hidden]{
display:none;
}

.toolbar{
padding:var(--_space-sm);
border-block-end:1px solid var(--_border-subtle);
background:var(--_surface-card);
}

.viewport{
grid-row:2;
position:relative;
min-block-size:0;
overflow:auto;
overscroll-behavior:contain;
background:var(--_surface-page);
scrollbar-gutter:stable;
direction:ltr;
}

.grid{
position:relative;
min-inline-size:100%;
}

.header,
.row{
display:grid;
grid-template-columns:var(--_gantt-name-width) minmax(0,1fr);
min-inline-size:max-content;
}

.header{
position:sticky;
inset-block-start:0;
z-index:var(--_layer-sticky);
block-size:var(--_gantt-header-height);
background:var(--_surface-card);
border-block-end:1px solid var(--_border-subtle);
}

.name-header,
.row-header{
position:sticky;
left:0;
z-index:var(--_layer-raised);
box-sizing:border-box;
inline-size:var(--_gantt-name-width);
background:var(--_surface-card);
border-inline-end:1px solid var(--_border-subtle);
}

.name-header{
display:flex;
align-items:center;
padding-inline:calc(
var(--_space-sm) + var(--_gantt-expander-width) + var(--_gantt-tree-gap)
)
var(--_space-sm);
font-size:var(--_gantt-axis-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-axis-line);
color:var(--_text-secondary);
}

.time-header,
.chart{
position:relative;
direction:ltr;
inline-size:var(--_gantt-chart-width);
min-inline-size:var(--_gantt-chart-width);
}

.axis-context{
position:absolute;
inset-block-start:4px;
inset-inline-start:var(--_axis-context-left);
z-index:1;
min-inline-size:10rem;
color:var(--_text-secondary);
font-size:var(--_gantt-axis-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-axis-line);
white-space:nowrap;
pointer-events:none;
}

.day{
position:absolute;
inset-block:26px 0;
inset-inline-start:var(--_day-left);
box-sizing:border-box;
inline-size:var(--_day-width);
overflow:visible;
color:var(--_text-primary);
font-size:var(--_gantt-axis-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-axis-line);
white-space:nowrap;
}

.day.grid-boundary{
box-shadow:inset 1px 0 0 var(--_border-subtle);
}

.day-label{
display:block;
box-sizing:border-box;
inline-size:var(--_day-label-width);
overflow:hidden;
padding:3px min(4px,calc(var(--_day-label-width) / 2));
text-overflow:ellipsis;
}

.day-label:empty{
display:none;
}

.body{
position:relative;
block-size:var(--_gantt-body-height);
min-inline-size:max-content;
}

.body-grid{
position:absolute;
inset-block:0;
inset-inline-start:var(--_gantt-name-width);
inline-size:var(--_gantt-chart-width);
overflow:hidden;
pointer-events:none;
}

.grid-line{
position:absolute;
inset-block:0;
inset-inline-start:var(--_grid-left);
border-inline-start:1px solid var(--_border-subtle);
}

.grid-line[hidden]{
display:none;
}

.row{
position:absolute;
inset-block-start:var(--_row-top);
inset-inline-start:0;
box-sizing:border-box;
block-size:var(--_row-height,var(--_gantt-row-height));
inline-size:calc(var(--_gantt-name-width) + var(--_gantt-chart-width));
border-block-end:1px solid var(--_border-subtle);
outline:none;
}

.row:focus-visible{
z-index:var(--_layer-raised);
box-shadow:inset 0 0 0 2px var(--_focus-ring);
}

.row-header{
display:grid;
grid-template-columns:var(--_gantt-expander-width) minmax(0,1fr) auto;
grid-template-rows:minmax(24px,1fr) auto;
align-items:center;
column-gap:var(--_gantt-tree-gap);
block-size:100%;
padding-inline:calc(var(--_space-sm) + var(--_row-indent)) var(--_space-sm);
overflow:hidden;
font-size:var(--_gantt-content-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-content-line);
}

:host(:dir(rtl)) .name-header,
:host(:dir(rtl)) .row-header{
direction:rtl;
}

.expander,
.row-label{
border:0;
background:transparent;
color:inherit;
font:inherit;
}

.expander{
display:grid;
grid-column:1;
grid-row:1;
place-items:center;
flex:0 0 var(--_gantt-expander-width);
block-size:var(--_gantt-expander-width);
padding:0;
border-radius:var(--_radius-sm);
cursor:pointer;
}

.expander:hover{
background:var(--_surface-hover);
}

.expander-placeholder{
grid-column:1;
grid-row:1;
inline-size:var(--_gantt-expander-width);
}

.row-label{
grid-column:2;
grid-row:1;
min-inline-size:0;
padding:0;
overflow:hidden;
text-align:start;
text-overflow:ellipsis;
white-space:nowrap;
cursor:pointer;
}

.chart{
block-size:100%;
overflow:hidden;
}

.item{
position:absolute;
display:flex;
align-items:center;
inset-block-start:var(--_item-top);
inset-inline-start:var(--_item-left);
box-sizing:border-box;
block-size:var(--_item-height);
min-block-size:24px;
overflow:hidden;
border:1px solid transparent;
border-radius:var(--_radius-sm);
background:var(--_gantt-work);
color:var(--_gantt-work-text);
font-size:var(--_gantt-content-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-content-line);
text-overflow:ellipsis;
white-space:nowrap;
cursor:pointer;
}

.item-label{
display:block;
min-inline-size:0;
overflow:hidden;
padding-inline:4px;
text-overflow:ellipsis;
white-space:nowrap;
}

.item[data-presentation="window"]{
background:var(--_gantt-window);
color:var(--_gantt-window-text);
border-block-start:1px dashed
color-mix(in srgb,currentColor 35%,transparent);
}

.item-geometry{
display:none;
}

.narrow-interval{
overflow:visible;
padding-inline-start:calc(var(--_item-geometry-width) + 4px);
border:0;
background:transparent;
color:var(--_text-primary);
}

.item.narrow-interval[data-presentation="window"]{
border-block-start:0;
background:transparent;
color:var(--_text-primary);
}

.narrow-interval .item-geometry{
position:absolute;
inset-block:0;
inset-inline-start:0;
display:block;
box-sizing:border-box;
inline-size:var(--_item-geometry-width);
border:1px solid transparent;
border-radius:var(--_radius-sm);
background:var(--_gantt-work);
}

.narrow-interval .item-label{
flex:0 0 auto;
max-inline-size:12rem;
background:var(--_surface-page);
color:var(--_text-primary);
}

.narrow-interval[data-presentation="window"] .item-geometry{
background:var(--_gantt-window);
border-block-start:1px dashed
color-mix(in srgb,currentColor 35%,transparent);
}

.narrow-interval[data-provenance="actual"] .item-geometry{
border-block-end:3px solid var(--_gantt-actual);
}

.item[data-provenance="actual"]{
border-block-end:3px solid var(--_gantt-actual);
}

.item.narrow-interval[data-provenance="actual"]{
border-block-end:0;
}

.item[data-provenance="planned"]::before,
.item[data-provenance="derived"]::before,
.item[data-provenance="advisory"]::before{
content: "≈";
flex:0 0 auto;
padding-inline-start:3px;
font-size:1em;
}

.item[data-provenance="planned"]::before{
content: "○";
}

.item[data-provenance="advisory"]::before{
content: "!";
font-weight:700;
}

.item[data-provenance="advisory"]:not(.milestone):not(.narrow-interval){
border-inline-start:3px solid var(--_gantt-advisory);
}

.narrow-interval[data-provenance="advisory"]{
border-inline-start:0;
}

.narrow-interval[data-provenance="advisory"] .item-geometry{
border-inline-start:3px solid var(--_gantt-advisory);
}

.item[aria-pressed="true"]{
box-shadow:0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_gantt-selection);
}

.item[data-active="true"]{
outline:2px solid var(--_focus-ring);
outline-offset:1px;
}

.milestone{
overflow:hidden;
padding:0;
border:0;
background:transparent;
color:var(--_text-primary);
}

.item.milestone::before{
content: "◆";
display:block;
flex:0 0 12px;
inline-size:12px;
padding:0;
margin-inline-end:4px;
color:var(--_gantt-work);
text-align:center;
}

.milestone.label-before{
flex-direction:row-reverse;
}

.milestone.label-before::before{
margin-inline:4px 0;
}

.unscheduled{
border-style:dotted;
background:var(--_surface-subtle);
color:var(--_text-secondary);
}

.unscheduled::before{
content: "Unscheduled · ";
font-weight:600;
}

.overflow-controls{
display:flex;
grid-column:2;
grid-row:2;
align-items:center;
justify-self:start;
gap:2px;
margin-block-start:2px;
}

.single-item-overflow{
grid-column:3;
grid-row:1;
}

.overflow-step,
.item-overflow{
display:inline-grid;
place-items:center;
box-sizing:border-box;
min-inline-size:24px;
min-block-size:24px;
border:1px solid var(--_border-subtle);
background:var(--_surface-subtle);
color:var(--_text-secondary);
font-size:var(--_gantt-axis-size);
font-weight:var(--_gantt-type-weight);
line-height:var(--_gantt-axis-line);
}

.overflow-step{
padding:0;
border-radius:var(--_radius-md);
font:inherit;
cursor:pointer;
}

.overflow-step:hover,
.overflow-step:focus-visible{
background:var(--_surface-hover);
outline:2px solid var(--_focus-ring);
outline-offset:1px;
}

.item-overflow{
padding-inline:4px;
border-radius:var(--_radius-sm);
}

.sr-only{
position:absolute;
inline-size:1px;
block-size:1px;
padding:0;
margin:-1px;
overflow:hidden;
clip:rect(0,0,0,0);
white-space:nowrap;
border:0;
}

.clipped-start{
border-start-start-radius:0;
border-end-start-radius:0;
}

.clipped-end{
border-start-end-radius:0;
border-end-end-radius:0;
}

.status{
position:sticky;
inset-inline-start:0;
box-sizing:border-box;
inline-size:min(100%,34rem);
margin:var(--_space-md);
padding:var(--_space-sm) var(--_space-md);
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_surface-card);
color:var(--_text-secondary);
font-size:var(--_body-size);
}

.status[data-kind="error"]{
border-color:var(--_danger-border);
}

@container (inline-size < 34rem){
.root{
--_gantt-name-width:var(--violet-gantt-name-column-width-narrow,10rem);
}
}

@media (prefers-reduced-motion:reduce){
.viewport{
scroll-behavior:auto;
}
}

@media (forced-colors:active){
.item[data-presentation="window"],
.narrow-interval[data-presentation="window"] .item-geometry{
border-block-start-color:CanvasText;
}

.root,
.header,
.name-header,
.row-header,
.status,
.item,
.item-geometry,
.item-overflow,
.overflow-step{
forced-color-adjust:none;
border-color:CanvasText;
background:Canvas;
color:CanvasText;
}

.item[aria-pressed="true"],
.item[data-active="true"],
.row:focus-visible{
outline:2px solid Highlight;
box-shadow:none;
}
}
`;var qb=/^(\d{4})-(\d{2})-(\d{2})$/;function te(t){let e=qb.exec(t);if(!e)return null;let i=Number(e[1]),o=Number(e[2]),r=Number(e[3]),n=new Date(0);return n.setUTCHours(0,0,0,0),n.setUTCFullYear(i,o-1,r),n.getUTCFullYear()!==i||n.getUTCMonth()!==o-1||n.getUTCDate()!==r?null:Math.floor(n.getTime()/864e5)}function Yt(t){let e=new Date(t*864e5),i=String(e.getUTCFullYear()).padStart(4,"0"),o=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return`${i}-${o}-${r}`}function vo(t){if(t.kind==="day-point"){let o=te(t.at);return o===null?null:{start:o,endExclusive:o,point:!0}}let e=te(t.start),i=te(t.endExclusive);return e===null||i===null||i<=e?null:{start:e,endExclusive:i,point:!1}}function go(t,e,i){let o=vo(t);return o?o.point?o.start>=e&&o.start<i:o.start<i&&o.endExclusive>e:!1}function Sh(t,e,i,o){let r=vo(t);if(!r||!go(t,e,i))return null;if(r.point)return{left:(r.start-e+.5)*o,width:0,clippedStart:!1,clippedEnd:!1,point:!0};let n=Math.max(r.start,e),s=Math.min(r.endExclusive,i);return{left:(n-e)*o,width:(s-n)*o,clippedStart:r.start<e,clippedEnd:r.endExclusive>i,point:!1}}var Se=Object.freeze({min:"0000-01-01",max:"9999-12-30",endExclusive:"9999-12-31",maxViewportDays:36600}),hr=52,zh=5,xn=2,Wb=256,Ai=24,Kb=12,Ub=6,Gb=192,Xt=864e5,Eh={day:40,week:16,month:4},Th={compact:36,natural:64,comfortable:76},Yb=0,$h=new Map;function bo(t,e){let i=`${t}|${JSON.stringify(e)}`,o=$h.get(i);return o||(o=new Intl.DateTimeFormat(t,e),$h.set(i,o)),o}function wn(t,e){return t.composedPath().find(i=>i instanceof HTMLElement&&i.hasAttribute(e))??null}var Xb=h`
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
`,Qb=h`
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
      ${g(t=>t.hasChildren,h`
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
        `,h`<span class="expander-placeholder" aria-hidden="true"></span>`)}
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
      ${g(t=>t.singleItemOverflow,h`
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
      ${g(t=>t.overflowCount>0&&!t.singleItemOverflow,h`
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
      ${N(t=>t.items,Xb)}
    </div>
  </div>
`,Jb=h`
  <div
    class="${t=>`day${t.gridBoundary?" grid-boundary":""}`}"
    part="day"
    style="${t=>t.style}"
    aria-hidden="true"
    title="${t=>t.title}"
  >
    <span class="day-label">${t=>t.label}</span>
  </div>
`,Zb=h`
  <span
    class="grid-line"
    style="${t=>t.gridStyle}"
    aria-hidden="true"
    ?hidden="${t=>!t.gridBoundary}"
  ></span>
`,ey=h`
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
            ${N(t=>t?.renderedDays??[],Jb)}
          </div>
        </div>
        <div class="body" part="body" style="${t=>t.bodyStyle}">
          <div class="body-grid" aria-hidden="true">
            ${N(t=>t?.renderedDays??[],Zb)}
          </div>
          ${N(t=>t?.renderedRows??[],Qb)}
        </div>
      </div>
      ${g(t=>t.shouldShowStatus,h`
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
`,Y=class extends y{#e=++Yb;#t=[];#o=[];#i=0;#r=new Map;#s=new Map;#n=new Map;#a=0;#d=null;#l=null;#c=null;#u=null;#p=null;#f=null;#h=null;#m=null;constructor(){super(),this.rows=[],this.items=[],this.expandedRowIds=[],this.selectedItemId=null,this.viewport={start:"2026-01-01",endExclusive:"2026-02-01",scale:"day"},this.status={kind:"ready"},this.today=null,this.presentedRowCount=0,this.renderedRows=[],this.renderedDays=[],this.axisContextLabel="",this.axisContextStyle="",this.validationMessage="",this.viewportError="",this.activeRowId=null,this.activeItemId=null,this.viewportWidth=0,this.viewportHeight=0,this.scrollTop=0,this.scrollLeft=0,this.hasToolbarContent=!1,this.density="natural",this.locale="",this.ariaLabel="Timeline"}connectedCallback(){super.connectedCallback(),this.handleToolbarSlotChange(),this.#D();let e=this.#M;e&&(this.#d=new ResizeObserver(i=>{let o=i[0]?.contentRect;o&&(this.viewportWidth=o.width,this.viewportHeight=o.height,this.#h=null,this.#C(),this.#w())}),this.#d.observe(e),this.viewportWidth=e.clientWidth,this.viewportHeight=e.clientHeight,this.#C()),this.#O()}disconnectedCallback(){this.#d?.disconnect(),this.#d=null,this.#l!==null&&cancelAnimationFrame(this.#l),this.#c!==null&&cancelAnimationFrame(this.#c),this.#l=null,this.#c=null,super.disconnectedCallback()}rowsChanged(){this.#D()}itemsChanged(){this.#D()}expandedRowIdsChanged(){this.#D()}selectedItemIdChanged(){this.#w()}viewportChanged(){this.viewportError=this.#Q().error;let e=this.#f;e&&!this.#b(this.viewport,e.source)&&(this.#f=null),this.#C(),!this.#_(!0)&&this.#w()}statusChanged(){this.#w()}localeChanged(){this.#w()}densityChanged(){this.#C(),this.#w()}get instructionsId(){return`violet-gantt-instructions-${this.#e}`}get rowHeight(){return Th[this.density]??Th.natural}get dayWidth(){return Eh[this.viewport?.scale]??Eh.day}get logicalRowCount(){return this.presentedRowCount+1}get chartWidth(){let e=this.#A;return Math.max(0,(e?.count??0)*this.dayWidth)}get gridStyle(){return`--_gantt-chart-width:${this.chartWidth}px;--_gantt-day-width:${this.dayWidth}px;`}get bodyStyle(){return this.renderedRows,`--_gantt-body-height:${this.#i}px;`}get effectiveStatusKind(){return this.viewportError?"error":this.#V}get statusText(){if(this.viewportError)return this.viewportError;let e=this.#V;return e!=="ready"?this.#Y?(typeof this.status.message=="string"?this.status.message:"")||{loading:"Loading timeline\u2026",empty:"No timeline items.",error:"Timeline unavailable."}[e]:"Invalid timeline status.":this.validationMessage}get shouldShowStatus(){return!!(this.viewportError||this.#V!=="ready"||this.validationMessage)}handleScroll(){let e=this.#M;e&&(this.scrollTop=e.scrollTop,this.scrollLeft=e.scrollLeft,this.#w())}handleToolbarSlotChange(e){let i=e?.currentTarget instanceof HTMLSlotElement?e.currentTarget:this.shadowRoot?.querySelector('slot[name="toolbar"]');this.hasToolbarContent=(i?.assignedNodes({flatten:!0})??[]).some(o=>o.nodeType===Node.TEXT_NODE?!!o.textContent?.trim():!0)}handleFocusIn(e){let i=wn(e,"data-row-id");i?.dataset.rowId&&(this.activeRowId=i.dataset.rowId,e.composedPath()[0]instanceof HTMLButtonElement||this.#w())}handleClick(e){let i=wn(e,"data-action"),o=i?.dataset.rowId;if(i?.dataset.action==="toggle"&&o){this.#E(o);return}if(i?.dataset.action==="inspect-row"&&o){this.activeRowId=o,this.activeItemId=null,this.$emit("row-inspect",{rowId:o});return}if(i?.dataset.action==="cycle-overflow"&&o){this.activeRowId=o,this.#$(o,i.dataset.direction==="previous"?-1:1),i.classList.contains("single-item-overflow")&&this.#I(o);return}let n=wn(e,"data-item-id")?.dataset.itemId;if(!n)return;let s=this.renderedRows.find(l=>l.items.some(d=>d.item.id===n));this.activeRowId=s?.row.id??this.activeRowId,this.activeItemId=n;let a=s?this.#s.get(s.row.id)?.find(l=>l.id===n):void 0;a&&this.#T(a),this.$emit("item-selection-change",{itemId:n}),this.$emit("item-activate",{itemId:n}),this.#w()}handleKeydown(e){if(e.composedPath().some(d=>d instanceof HTMLButtonElement))return;let o=wn(e,"data-row-id")?.dataset.rowId??this.activeRowId,r=o?this.#t.findIndex(d=>d.row.id===o):-1;if(r<0)return;let n=this.#t[r];if(e.altKey&&(e.key==="ArrowRight"||e.key==="ArrowLeft")){this.#$(n.row.id,e.key==="ArrowRight"?1:-1)&&e.preventDefault();return}let s=Math.max(this.rowHeight,this.viewportHeight-hr),a=getComputedStyle(this).direction==="rtl";switch(e.key==="ArrowRight"||e.key==="ArrowLeft"?e.key==="ArrowRight"!==a?"Expand":"Collapse":e.key){case"ArrowDown":e.preventDefault(),this.#y(Math.min(this.#t.length-1,r+1));break;case"ArrowUp":e.preventDefault(),this.#y(Math.max(0,r-1));break;case"Home":e.preventDefault(),this.#y(0);break;case"End":e.preventDefault(),this.#y(this.#t.length-1);break;case"PageDown":e.preventDefault(),this.#y(Math.max(r+1,this.#k((this.#o[r]?.top??0)+s)));break;case"PageUp":e.preventDefault(),this.#y(Math.min(r-1,this.#k((this.#o[r]?.top??0)-s)));break;case"Expand":e.preventDefault(),n.hasChildren&&!n.expanded?this.#E(n.row.id):n.hasChildren&&n.expanded&&this.#y(r+1);break;case"Collapse":e.preventDefault(),n.hasChildren&&n.expanded?this.#E(n.row.id):n.parentId&&this.#y(this.#t.findIndex(d=>d.row.id===n.parentId));break;case"Enter":{if(e.preventDefault(),e.shiftKey){this.$emit("row-inspect",{rowId:n.row.id});break}let d=this.#R(n),u=d.find(p=>p.id===this.activeItemId)??d[0];u?(this.activeItemId=u.id,this.$emit("item-selection-change",{itemId:u.id}),this.$emit("item-activate",{itemId:u.id})):this.$emit("row-inspect",{rowId:n.row.id}),this.#w();break}case"Escape":e.preventDefault(),this.activeItemId=null,this.#w(),this.#I(n.row.id);break}}focusItem(e){let i=this.#t.findIndex(s=>this.#s.get(s.row.id)?.some(a=>a.id===e));if(i<0)return!1;let o=this.#t[i];if(!o)return!1;let r=this.#s.get(o.row.id)?.find(s=>s.id===e),n=this.#A;return!r||!n||r.time&&!go(r.time,n.start,n.endExclusive)?!1:(this.activeItemId=e,this.#y(i,!0),this.#T(r),!0)}scrollToDate(e){let i=te(e),o=this.#A;if(i===null||!o||!this.#x(i))return!1;if(i<o.start||i>=o.endExclusive){let n=this.#z(i,o.count);return n?(this.#p=i,this.#g({...n,scale:this.viewport.scale},"programmatic"),this.#_(),!0):!1}let r=this.#M;return r&&(r.scrollLeft=Math.max(0,(i-o.start)*this.dayWidth-this.#j)),!0}panBy(e){let i=this.#A;if(!i||!Number.isSafeInteger(e))return!1;let o=Yt(i.start+e),r=Yt(i.endExclusive+e);return this.#K(o,r)?(this.#g({start:o,endExclusive:r,scale:this.viewport.scale},"pan"),!0):!1}showToday(){if(typeof this.today!="string"||!this.today)return!1;let e=te(this.today),i=this.#A;if(e===null||!i||!this.#x(e))return!1;let o=this.#z(e,i.count);return o?(this.#p=e,this.#g({...o,scale:this.viewport.scale},"today"),this.#_(),!0):!1}fitItems(){let e=Number.POSITIVE_INFINITY,i=Number.NEGATIVE_INFINITY;for(let a of this.#s.values())for(let l of a){if(!l.time)continue;let d=vo(l.time);d&&(e=Math.min(e,d.start),i=Math.max(i,d.point?d.start+1:d.endExclusive))}if(!Number.isFinite(e)||!Number.isFinite(i))return!1;let o=Math.max(te(Se.min)??e,e-1),r=Math.min(te(Se.endExclusive)??i,i+1),n=Yt(o),s=Yt(r);return this.#K(n,s)?(this.#g({start:n,endExclusive:s,scale:this.viewport.scale},"fit"),!0):!1}#g(e,i){this.$emit("viewport-change",{viewport:e,reason:i})}#v(e){if(this.#V==="loading"||this.#V==="error")return;let i=this.#M;if(!i)return;let o=i.clientWidth-this.#j;if(o<=0)return;let r=Math.ceil(o/this.dayWidth);if(r<=e.count)return;let n=this.#f;if(n&&this.#b(this.viewport,n.source)&&n.requestedDays>=r)return;let s=te(Se.endExclusive);if(s===null)return;let a=Math.min(e.start+Se.maxViewportDays,e.start+r,s);if(a<=e.endExclusive)return;let l=Yt(a);this.#K(this.viewport.start,l)&&(this.#f={source:{...this.viewport},requestedDays:r},this.#g({...this.viewport,endExclusive:l},"resize"))}#b(e,i){return e?.start===i?.start&&e?.endExclusive===i?.endExclusive&&e?.scale===i?.scale}#_(e=!1){let i=this.#p;if(i===null)return!1;let o=this.#A;if(!o||i<o.start||i>=o.endExclusive)return e&&o&&(this.#p=null),!1;let r=this.#M;if(!r)return!1;let n=Math.max(this.dayWidth,this.viewportWidth-this.#j),s=(i-o.start)*this.dayWidth;return r.scrollLeft=Math.max(0,s-n/2+this.dayWidth/2),this.scrollLeft=r.scrollLeft,this.#p=null,this.#O(),!0}#z(e,i){let o=te(Se.min),r=te(Se.endExclusive);if(o===null||r===null||i<=0||i>r-o||e<o||e>=r)return null;let n=e-Math.floor(i/2),s=Math.max(o,Math.min(n,r-i));return{start:Yt(s),endExclusive:Yt(s+i)}}#E(e){let i=new Set(Array.isArray(this.expandedRowIds)?this.expandedRowIds.filter(o=>typeof o=="string"):[]);i.has(e)?i.delete(e):i.add(e),this.$emit("expanded-change",{expandedRowIds:[...i]})}#$(e,i){let o=this.#t.find(l=>l.row.id===e);if(!o)return!1;let r=this.#R(o);if(r.length===0)return!1;let n=r.findIndex(l=>l.id===this.activeItemId),s=n<0?i>0?0:r.length-1:(n+i+r.length)%r.length,a=r[s];return this.activeItemId=a?.id??null,a&&this.#T(a),!0}#C(){let e=this.#A,i=this.rowHeight,o=0;this.#o=this.#t.map(r=>{let n=(this.#s.get(r.row.id)??[]).filter(d=>!d.time||e&&go(d.time,e.start,e.endExclusive)),s=Math.min(Ub,Math.max(1,n.length)),a=Math.max(i,s*Ai+Kb),l={top:o,height:a,laneCapacity:s};return o+=a,l}),this.#i=o,this.#S()}#k(e){if(this.#o.length===0)return-1;let i=Math.max(0,Math.min(e,Math.max(0,this.#i-1))),o=0,r=this.#o.length;for(;o<r;){let n=Math.floor((o+r)/2),s=this.#o[n];s&&s.top+s.height<=i?o=n+1:r=n}return Math.min(o,this.#o.length-1)}#S(){let e=this.#M,i=e?.clientHeight??this.viewportHeight;if(!Number.isFinite(i)||i<=0)return;let o=Math.max(0,hr+this.#i-i),r=Math.max(0,Math.min(e?.scrollTop??this.scrollTop,o));e&&e.scrollTop!==r&&(e.scrollTop=r),this.scrollTop=r}#y(e,i=!1){let o=this.#t[e],r=this.#o[e];if(!o||!r)return;this.activeRowId=o.row.id,this.#u=o.row.id,i||(this.activeItemId=null);let n=this.#M;if(n){let s=n.scrollTop,a=n.scrollTop+Math.max(0,n.clientHeight-hr);r.top<s?n.scrollTop=r.top:r.top+r.height>a&&(n.scrollTop=r.top+r.height-(n.clientHeight-hr)),this.scrollTop=n.scrollTop}this.#O(),this.#I(o.row.id)}#I(e){this.#u=e,this.#c!==null&&cancelAnimationFrame(this.#c),this.#c=requestAnimationFrame(()=>{this.#c=null,M.next().then(()=>{if(this.#u!==e||!this.$fastController.isConnected)return;let o=[...this.shadowRoot?.querySelectorAll(".row[data-row-id]")??[]].find(r=>r.dataset.rowId===e);o&&(o.focus(),this.#u=null)})})}#w(){this.#h=null,!(!this.$fastController.isConnected||this.#l!==null)&&(this.#l=requestAnimationFrame(()=>{this.#l=null,this.#O()}))}#O(){this.#h=null;let e=this.#A;if(!e){this.renderedRows=[],this.renderedDays=[],this.axisContextLabel="",this.axisContextStyle="";return}let i=Math.max(this.rowHeight,this.viewportHeight-hr),o=this.#Z,r=this.#u??o,n=this.#k(this.scrollTop),s=this.#k(this.scrollTop+i),a=Math.max(0,n-zh),l=Math.min(this.#t.length,s+1+zh),d=new Set(Array.from({length:Math.max(0,l-a)},(F,_)=>a+_)),u=r?this.#t.findIndex(F=>F.row.id===r):-1;u>=0&&d.add(u),this.renderedRows=[...d].sort((F,_)=>F-_).flatMap(F=>{let _=this.#t[F];return _?[this.#L(_)]:[]}),this.#u&&this.#I(this.#u);let p=Math.max(this.dayWidth,this.viewportWidth-this.#j),v=Math.max(0,Math.floor(this.scrollLeft/this.dayWidth)-xn),k=Math.min(e.count,Math.ceil((this.scrollLeft+p)/this.dayWidth)+xn),S=Math.min(e.endExclusive-1,e.start+Math.max(0,Math.floor(this.scrollLeft/this.dayWidth))),R=Math.min(e.endExclusive-1,e.start+Math.ceil((this.scrollLeft+p)/this.dayWidth)-1);if(this.axisContextLabel=this.#U(S),this.viewport.scale==="month"){let F=this.#U(R);F!==this.axisContextLabel&&(this.axisContextLabel+=` \u2013 ${F}`)}this.axisContextStyle=`--_axis-context-left:${this.scrollLeft+8}px;`,this.renderedDays=Array.from({length:Math.max(0,k-v)},(F,_)=>{let $=v+_,D=e.start+$,O=Yt(D),L=Math.min(this.#X(D),e.endExclusive-D),P=this.#J(D);return{date:O,label:this.#F(D,S),title:this.#H(D),style:`--_day-left:${$*this.dayWidth}px;--_day-width:${this.dayWidth}px;--_day-label-width:${L*this.dayWidth}px;`,gridStyle:`--_grid-left:${$*this.dayWidth}px;`,gridBoundary:P}}),this.#v(e)}#L(e){let i=this.#o[e.logicalIndex]??{top:e.logicalIndex*this.rowHeight,height:this.rowHeight,laneCapacity:1},o=this.#q(e),r=o.items,n=r.find(s=>s.item.id===this.activeItemId);return{...e,style:`--_row-top:${i.top}px;--_row-height:${i.height}px;`,indentStyle:`--_row-indent:${Math.max(0,e.level-1)*16}px;`,items:r,tabIndex:this.activeRowId===e.row.id||!this.activeRowId&&e.logicalIndex===0?"0":"-1",activeDescendant:n?.elementId??null,overflowCount:o.overflowCount,singleItemOverflow:o.singleItemOverflow}}#q(e){let i=this.#A;if(!i)return{items:[],overflowCount:0,singleItemOverflow:!1};let o=this.#N(i),n=(this.#s.get(e.row.id)??[]).flatMap(_=>{if(!_.time)return this.scrollLeft<=220?[{item:_,left:8,width:Math.min(180,Math.max(80,_.label.length*7+92)),point:!1,clippedStart:!1,clippedEnd:!1,unscheduled:!0}]:[];if(!o||!go(_.time,o.start,o.endExclusive))return[];let $=Sh(_.time,i.start,i.endExclusive,this.dayWidth);return $?[{item:_,...$,unscheduled:!1}]:[]}),s=this.#o[e.logicalIndex],a=s?.height??this.rowHeight,l=s?.laneCapacity??1,d=n.slice(0,l),u=n.findIndex(_=>_.item.id===this.activeItemId&&e.row.id===this.activeRowId),p=n[u];u>=l&&l>0&&p&&(d=[...d.slice(0,-1),p]);let v=Math.max(2,(a-d.length*Ai)/2),k=d.map((_,$)=>{let D=_.item,O=D.id===this.selectedItemId,L=D.id===this.activeItemId&&e.row.id===this.activeRowId,P=_.point?Math.min(Gb,Math.max(120,D.label.length*7+24)):Math.max(Ai,_.width),W=this.chartWidth-(_.left-6),ge=_.left+6,Te=_.point&&P>W&&ge>W,ut=_.point?Math.max(Ai,Math.min(P,Te?ge:W)):P,Oe=_.point?Te?Math.max(0,ge-ut):_.left-6:_.left,qe=!_.point&&!_.unscheduled&&_.width<Ai,Jt=["item",D.presentation==="milestone"?"milestone":"",Te?"label-before":"",qe?"narrow-interval":"",_.unscheduled?"unscheduled":"",_.clippedStart?"clipped-start":"",_.clippedEnd?"clipped-end":""].filter(Boolean).join(" "),ht=["item",D.presentation,_.unscheduled?"unscheduled":"",O?"selection":""].filter(Boolean).join(" ");return{item:D,style:`--_item-left:${Oe}px;--_item-top:${v+$*Ai}px;--_item-height:${Ai}px;--_item-geometry-width:${Math.max(2,_.width)}px;inline-size:${ut}px;`,className:Jt,partName:ht,selected:O,active:L,title:this.#G(D),elementId:this.#P(D.id)}}),S=new Set(k.map(_=>_.item.id)),R=this.#R(e),F=R.reduce((_,$)=>_+(S.has($.id)?0:1),0);return{items:k,overflowCount:F,singleItemOverflow:F===1&&R.length===1}}#R(e){let i=this.#A;return i?(this.#s.get(e.row.id)??[]).filter(o=>!o.time||go(o.time,i.start,i.endExclusive)):[]}#T(e){let i=this.#M,o=this.#A;if(!(!i||!o)){if(!e.time)i.scrollLeft=0;else{let r=vo(e.time);if(r){let n=(r.start-o.start)*this.dayWidth,s=Math.max(this.dayWidth,this.viewportWidth-this.#j);(n<this.scrollLeft||n>this.scrollLeft+s-this.dayWidth)&&(i.scrollLeft=Math.max(0,n-s/2))}}this.scrollLeft=i.scrollLeft,this.#O()}}#P(e){let i=this.#n.get(e);if(i)return i;let o=`violet-gantt-${this.#e}-item-${++this.#a}`;return this.#n.set(e,o),o}#G(e){let i=this.#B(e.time),o=e.readOnlyReason?`. Read only: ${e.readOnlyReason}`:". Read only.";return`${e.label}. ${e.presentation}. ${i}. ${e.provenance}${o}${e.note?` ${e.note}`:""}`}#B(e){if(!e)return"Unscheduled";let i=bo(this.resolvedLocale,{dateStyle:"medium",timeZone:"UTC"});if(e.kind==="day-point"){let l=te(e.at);return l===null?e.at:i.format(new Date(l*Xt))}let o=te(e.start),r=te(e.endExclusive);if(o===null||r===null||r<=o)return`${e.start} to ${e.endExclusive}`;let n=r-o,s=new Date(o*Xt);return`${n===1?i.format(s):i.formatRange(s,new Date((r-1)*Xt))} (${n} ${n===1?"day":"days"})`}#N(e){let i=Math.max(this.dayWidth,this.viewportWidth-this.#j),o=Math.max(0,Math.floor(this.scrollLeft/this.dayWidth)-xn),r=Math.min(e.count,Math.ceil((this.scrollLeft+i)/this.dayWidth)+xn);return{start:e.start+o,endExclusive:e.start+Math.max(o+1,r)}}get#Z(){return this.shadowRoot?.activeElement?.closest(".row[data-row-id]")?.dataset.rowId??null}get#W(){let e=this.shadowRoot?.activeElement;return e===this.#M||!!e?.closest(".row[data-row-id]")}#D(){let e=this.#r,i=this.activeRowId,o=this.#W,r=[],n=new Map;for(let _ of Array.isArray(this.rows)?this.rows:[]){if(!this.#te(_)||n.has(_.id)){r.push("duplicate, empty, or non-text row data");continue}n.set(_.id,_)}let s=new Map;for(let _ of n.keys()){if(s.has(_))continue;let $=[],D=new Set,O=_,L="valid";for(;O;){let P=s.get(O);if(P){L=P;break}if(D.has(O)){L="invalid";break}let W=n.get(O);if(!W){L="invalid";break}D.add(O),$.push(O),O=W.parentId??null}for(let P of $)s.set(P,L);L==="invalid"&&r.push("orphan or cyclic row identity")}let a=new Map([...n].filter(([_])=>s.get(_)==="valid")),l=new Map;for(let _ of a.values()){let $=_.parentId??null,D=l.get($)??[];D.push(_),l.set($,D)}let d=new Set(Array.isArray(this.expandedRowIds)?this.expandedRowIds.filter(_=>typeof _=="string"):[]),u=[],p=l.get(null)??[],v=p.map((_,$)=>({row:_,level:1,positionInSet:$+1,setSize:p.length})).reverse();for(;v.length>0;){let _=v.pop();if(!_)break;let{row:$,level:D,positionInSet:O,setSize:L}=_,P=l.get($.id)??[],W=d.has($.id);if(u.push({row:$,logicalIndex:u.length,level:D,positionInSet:O,setSize:L,parentId:$.parentId??null,hasChildren:P.length>0,expanded:W}),W)for(let ge=P.length-1;ge>=0;ge-=1){let Te=P[ge];Te&&v.push({row:Te,level:D+1,positionInSet:ge+1,setSize:P.length})}}let k=new Map;for(let _ of Array.isArray(this.items)?this.items:[]){if(!this.#ie(_)||k.has(_.id)){r.push("duplicate, empty, or non-text item data");continue}k.set(_.id,_)}let S=new Map,R=new Set;for(let _ of a.values()){let $=[],D=new Set;for(let O of _.itemIds??[]){if(D.has(O)){r.push("duplicate row item identity");continue}D.add(O);let L=k.get(O);if(!L||L.rowId!==_.id){r.push("orphan or mismatched item identity");continue}if(!this.#ee(L)){r.push("invalid item date or presentation");continue}R.add(L.id),$.push(L)}S.set(_.id,$)}R.size!==k.size&&r.push("unreferenced item identity");for(let _ of this.#n.keys())R.has(_)||this.#n.delete(_);if(this.#r=a,this.#s=S,this.#t=u,this.presentedRowCount=u.length,this.#C(),this.validationMessage=r.length?`${r.length} invalid timeline record${r.length===1?" was":"s were"} omitted.`:"",i&&!u.some(_=>_.row.id===i)){let _=e.get(i)?.parentId??null;for(;_&&!u.some($=>$.row.id===_);)_=e.get(_)?.parentId??null;this.activeRowId=_??u[0]?.row.id??null}else this.activeRowId||(this.activeRowId=u[0]?.row.id??null);u.length||(this.activeRowId=null),(this.activeRowId?S.get(this.activeRowId)??[]:[]).some(_=>_.id===this.activeItemId)||(this.activeItemId=null),this.#u&&!u.some(_=>_.row.id===this.#u)&&(this.#u=null),o&&this.$fastController.isConnected&&this.activeRowId&&this.#I(this.activeRowId),this.$fastController.isConnected?this.#O():this.#w()}#te(e){return!!(e&&typeof e.id=="string"&&e.id.length>0&&typeof e.label=="string"&&(e.parentId===void 0||typeof e.parentId=="string")&&(e.description===void 0||typeof e.description=="string")&&Array.isArray(e.itemIds)&&e.itemIds.every(i=>typeof i=="string"))}#ie(e){return!!(e&&typeof e.id=="string"&&e.id.length>0&&typeof e.rowId=="string"&&e.rowId.length>0&&typeof e.label=="string"&&(e.note===void 0||typeof e.note=="string")&&(e.readOnlyReason===void 0||typeof e.readOnlyReason=="string")&&["work","window","milestone"].includes(e.presentation)&&["planned","derived","actual","advisory"].includes(e.provenance))}#ee(e){if(!e.time)return!0;if(typeof e.time!="object"||e.time.kind==="day-point"&&typeof e.time.at!="string"||e.time.kind==="day-range"&&(typeof e.time.start!="string"||typeof e.time.endExclusive!="string")||e.time.kind!=="day-point"&&e.time.kind!=="day-range")return!1;let i=vo(e.time);return!i||!this.#x(i.start)||!i.point&&!this.#x(i.endExclusive-1)?!1:e.presentation==="milestone"?i.point:!i.point}get#Y(){return!!(this.status&&typeof this.status=="object"&&["ready","loading","empty","error"].includes(this.status.kind)&&(this.status.message===void 0||typeof this.status.message=="string"))}get#V(){return this.#Y?this.status.kind:"error"}get#A(){return this.#Q().days}#Q(){let e=this.viewport,i=this.#m;if(i&&i.start===e?.start&&i.endExclusive===e?.endExclusive&&i.scale===e?.scale)return i;let o=te(e?.start??""),r=te(e?.endExclusive??""),n=te(Se.min)??0,s=te(Se.endExclusive)??0,a=o===null||r===null?0:r-o,l=e&&["day","week","month"].includes(e.scale),d=o===null||r===null||a<=0||a>Se.maxViewportDays||o<n||r>s||!l,u={start:e?.start,endExclusive:e?.endExclusive,scale:e?.scale,days:d?null:{start:o,endExclusive:r,count:a},error:d?`Viewport must be a half-open YYYY-MM-DD range within ${Se.min}\u2013${Se.endExclusive}, spanning at most ${Se.maxViewportDays.toLocaleString()} days.`:""};return this.#m=u,u}#x(e){let i=te(Se.min)??0,o=te(Se.max)??0;return e>=i&&e<=o}#K(e,i){let o=te(e),r=te(i);return o!==null&&r!==null&&this.#x(o)&&r>o&&r<=(te(Se.endExclusive)??r)&&r-o<=Se.maxViewportDays}#F(e,i){let o=new Date(e*Xt);return this.viewport.scale==="month"?e>=i&&(o.getUTCDate()===1||e===i&&this.#X(e)*this.dayWidth>=24)?bo(this.resolvedLocale,{month:"short",timeZone:"UTC"}).format(o):"":this.viewport.scale==="week"?o.getUTCDay()===1?bo(this.resolvedLocale,{month:"short",day:"numeric",timeZone:"UTC"}).format(o):"":bo(this.resolvedLocale,{day:"numeric",timeZone:"UTC"}).format(o)}#X(e){if(this.viewport.scale==="week")return 7;if(this.viewport.scale!=="month")return 1;let i=new Date(e*Xt),o=new Date(i.getTime());return o.setUTCFullYear(i.getUTCFullYear(),i.getUTCMonth()+1,1),Math.max(1,Math.round((o.getTime()-i.getTime())/Xt))}#J(e){if(this.viewport.scale==="day")return!0;let i=new Date(e*Xt);return this.viewport.scale==="week"?i.getUTCDay()===1:i.getUTCDate()===1}#H(e){return bo(this.resolvedLocale,{dateStyle:"full",timeZone:"UTC"}).format(new Date(e*Xt))}#U(e){return bo(this.resolvedLocale,{...this.viewport.scale==="month"?{}:{month:"long"},year:"numeric",timeZone:"UTC"}).format(new Date(e*Xt))}get#j(){if(this.#h===null){let i=this.shadowRoot?.querySelector(".name-header")?.getBoundingClientRect().width??0;this.#h=i>0?i:Wb}return this.#h}get resolvedLocale(){return this.locale||document.documentElement.lang||navigator.language||"en-US"}get#M(){return this.shadowRoot?.querySelector(".viewport")}};c(Y.prototype,"density");c(Y.prototype,"locale");c({attribute:"aria-label",mode:"fromView"})(Y.prototype,"ariaLabel");f(Y.prototype,"rows");f(Y.prototype,"items");f(Y.prototype,"expandedRowIds");f(Y.prototype,"selectedItemId");f(Y.prototype,"viewport");f(Y.prototype,"status");f(Y.prototype,"today");f(Y.prototype,"presentedRowCount");f(Y.prototype,"renderedRows");f(Y.prototype,"renderedDays");f(Y.prototype,"axisContextLabel");f(Y.prototype,"axisContextStyle");f(Y.prototype,"validationMessage");f(Y.prototype,"viewportError");f(Y.prototype,"activeRowId");f(Y.prototype,"activeItemId");f(Y.prototype,"viewportWidth");f(Y.prototype,"viewportHeight");f(Y.prototype,"scrollTop");f(Y.prototype,"scrollLeft");f(Y.prototype,"hasToolbarContent");var Ih={name:"violet-gantt",template:ey,styles:Ch};var ty=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},iy=b`
    ${A}

:host{
display:block;
--_image-background:var(--violet-image-background,var(--_surface-subtle));
--_image-border:var(--violet-image-border,var(--_border-subtle));
--_image-radius:var(--violet-image-radius,var(--_radius-lg));
--_image-fit:var(--violet-image-fit,cover);
--_image-ratio:auto;
}

:host([shape="square"]){
--_image-radius:var(--_radius-sm);
}

:host([shape="rounded"]){
--_image-radius:var(--_radius-lg);
}

:host([shape="circle"]){
--_image-radius:var(--_radius-round);
}

:host([ratio="square"]){
--_image-ratio:1 / 1;
}

:host([ratio="landscape"]){
--_image-ratio:4 / 3;
}

:host([ratio="portrait"]){
--_image-ratio:3 / 4;
}

:host([ratio="video"]){
--_image-ratio:16 / 9;
}

:host([fit="contain"]){
--_image-fit:contain;
}

:host([fit="fill"]){
--_image-fit:fill;
}

.root{
position:relative;
box-sizing:border-box;
display:block;
inline-size:100%;
overflow:hidden;
border:1px solid var(--_image-border);
border-radius:var(--_image-radius);
background:var(--_image-background);
aspect-ratio:var(--_image-ratio);
}

.media,
.fallback{
inline-size:100%;
block-size:100%;
}

.media{
display:block;
object-fit:var(--_image-fit);
background:var(--_image-background);
}

.fallback{
display:grid;
place-items:center;
min-block-size:6rem;
color:var(--_text-muted);
font-size:var(--_caption-size);
line-height:var(--_caption-line);
text-align:center;
}

.fallback slot::slotted(*){
margin:0;
}

@media (forced-colors:active){
.root{
forced-color-adjust:none;
background:Canvas;
border-color:ButtonText;
}

.fallback{
color:CanvasText;
}
}
`,oy=h`
    <div
        class="root"
        part="root"
        role="${t=>t.accessibleRole}"
        aria-label="${t=>t.accessibleLabel}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
    >
        ${g(t=>!!t.src,h`
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
`,Qe=class extends y{constructor(){super(),this.src="",this.alt="",this.fit="cover",this.ratio="auto",this.shape="rounded",this.loading="lazy",this.decorative=!1,this.imageFailed=!1}connectedCallback(){super.connectedCallback(),this.syncVisualState()}srcChanged(){this.imageFailed=!1,this.syncVisualState()}get showImage(){return T.trackVolatile(),!!this.src&&!this.imageFailed}get computedAlt(){return T.trackVolatile(),this.decorative?"":this.alt}get accessibleRole(){return T.trackVolatile(),this.decorative||this.showImage?null:this.alt.trim()?"img":null}get accessibleLabel(){return T.trackVolatile(),this.decorative||this.showImage?null:this.alt.trim()||null}handleImageError(){this.imageFailed=!0,this.syncVisualState()}syncVisualState(){let e=this.shadowRoot?.querySelector(".media"),i=this.shadowRoot?.querySelector(".fallback");e&&(e.hidden=this.imageFailed),i&&(i.hidden=this.showImage)}};ty([f],Qe.prototype,"imageFailed",void 0);c(Qe.prototype,"src");c(Qe.prototype,"alt");c(Qe.prototype,"fit");c(Qe.prototype,"ratio");c(Qe.prototype,"shape");c(Qe.prototype,"loading");c({mode:"boolean"})(Qe.prototype,"decorative");var Ah={name:"violet-image",template:oy,styles:iy};var ry='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M5 5L19 19"/><path d="M19 5L5 19"/></svg>',Rh=new Map;function ny(t){let e=Rh.get(t);return e||(e=h`${h.partial(t)}`,Rh.set(t,e)),e}var sy=b`
:host{
display:inline-flex;
inline-size:var(--violet-icon-size,1em);
block-size:var(--violet-icon-size,1em);
align-items:center;
justify-content:center;
aspect-ratio:1 / 1;
color:inherit;
flex:0 0 auto;
}

.glyph{
display:inline-flex;
inline-size:100%;
block-size:100%;
align-items:center;
justify-content:center;
color:inherit;
}

.glyph svg{
display:block;
inline-size:100%;
block-size:100%;
}
`,ay=h`
    <span
        class="glyph"
        part="glyph"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-label="${t=>t.decorative?null:t.label||t.icon}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
    >
        ${t=>ny(vl(t.icon)?.svg??ry)}
    </span>
`,Ri=class extends y{constructor(){super(),this.icon="system/search",this.label="",this.decorative=!1}};c(Ri.prototype,"icon");c(Ri.prototype,"label");c({mode:"boolean"})(Ri.prototype,"decorative");var Dh={name:"violet-icon",template:ay,styles:sy};var ly=b`
    ${De}

:host{
display:inline-flex;
vertical-align:middle;
--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_icon-size:clamp(16px,calc(var(--_target-size) * 0.5),20px);
}

.control{
box-sizing:border-box;
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:var(--_target-size);
block-size:var(--_target-size);
padding:0;
border:thin solid transparent;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
box-shadow:none;
cursor:pointer;
font-family:inherit;
font-size:var(--_control-type-size);
line-height:1;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control:focus-visible{
outline:2px solid var(--_focus-ring);
outline-offset:calc(var(--_space-inline-sm) / 2);
}


.control[data-appearance="primary"]{
background:var(--_action-primary-background);
color:var(--_action-primary-text);
box-shadow:var(--_shadow-control);
}

.control[data-appearance="primary"]:hover{
background:var(--_action-primary-hover);
}

.control[data-appearance="primary"]:active{
background:var(--_action-primary-pressed);
box-shadow:none;
}

.control[data-appearance="secondary"]{
background:var(--_action-secondary-background);
color:var(--_action-secondary-text);
border-color:var(--_action-secondary-border);
}

.control[data-appearance="secondary"]:hover{
background:var(--_action-secondary-hover);
}

.control[data-appearance="secondary"]:active{
background:var(--_action-secondary-pressed);
}


.control[data-appearance="quiet"]{
color:var(--_text-secondary);
background:transparent;
}

.control[data-appearance="quiet"]:hover{
background:var(--_action-secondary-background);
}

.control[data-appearance="quiet"]:active{
background:var(--_action-secondary-pressed);
}

.control[data-appearance="transparent"]{
color:var(--_text-secondary);
background:transparent;
}

.control[data-appearance="transparent"]:hover{
background:var(--_action-secondary-background);
}

.control[data-appearance="transparent"]:active{
background:var(--_action-secondary-pressed);
}

.control[disabled]{
opacity:0.5;
cursor:not-allowed;
box-shadow:none;
}

.icon{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:var(--_icon-size);
block-size:var(--_icon-size);
min-inline-size:var(--_icon-size);
min-block-size:var(--_icon-size);
flex:0 0 auto;
line-height:0;
}

::slotted(*){
max-inline-size:100%;
max-block-size:100%;
}

::slotted(img),
::slotted(svg),
::slotted(violet-icon){
display:block;
inline-size:100%;
block-size:100%;
}

::slotted(violet-icon){
--violet-icon-size:var(--_icon-size);
color:inherit;
}

::slotted(img){
object-fit:cover;
}

@media (forced-colors:active){
.control[data-appearance="quiet"],
.control[data-appearance="transparent"]{
color:ButtonText;
}

.control:focus-visible{
outline-color:Highlight;
}

.control[disabled]{
color:GrayText;
opacity:1;
}
}
`,cy=h`
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
`,pi=class extends y{constructor(){super(),this.appearance="secondary",this.label="",this.type="button",this.disabled=!1}};c(pi.prototype,"appearance");c(pi.prototype,"label");c(pi.prototype,"type");c({mode:"boolean"})(pi.prototype,"disabled");var Fh={name:"violet-icon-button",template:cy,styles:ly,shadowOptions:{delegatesFocus:!0}};yo();var fy=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Nh=0,my=b`
    ${De}

:host{
display:inline-flex;
vertical-align:middle;
--_panel-min-inline:var(--violet-menu-min-inline-size,180px);
--_panel-max-inline:var(--violet-menu-max-inline-size,320px);
--_panel-max-block:var(--violet-menu-max-height,360px);
--_panel-padding:var(--violet-menu-padding,var(--_space-inline-sm));
--_panel-radius:var(--violet-menu-radius,var(--violet-radius-floating,12px));
--_panel-gap:var(--violet-menu-gap,var(--_space-inline-sm));
--_panel-background:var(--violet-menu-background,var(--violet-color-surface-floating,#ffffff));

--_shadow-floating:var(--violet-shadow-floating,0 0 0 1px rgba(24,27,26,0.08),0 4px 12px -2px rgba(24,27,26,0.12),0 18px 40px -8px rgba(24,27,26,0.20));
--_panel-shadow:var(--violet-menu-shadow,var(--_shadow-floating));

--_panel-border-color:var(--violet-menu-border-color,transparent);
}

.anchor{
display:inline-flex;
}

.panel{
box-sizing:border-box;
position:fixed;
min-inline-size:var(--_panel-min-inline);
max-inline-size:var(--_panel-max-inline);
max-block-size:min(var(--_panel-max-block),80vh);
overflow-y:auto;
overscroll-behavior:contain;

inset:unset;
margin:0;
padding:var(--_panel-padding);
border:thin solid var(--_panel-border-color);
border-radius:var(--_panel-radius);
background:var(--_panel-background);
box-shadow:var(--_panel-shadow);
color:inherit;
font-family:inherit;
font-size:var(--_control-type-size);
line-height:var(--_type-body-line);
z-index:var(--_layer-popover);
}

@supports (anchor-name:--violet-anchor) and (position-area:block-end span-inline-end) and (position-try-fallbacks:flip-block){
.panel{
position-area:block-end span-inline-end;
margin-block-start:var(--_panel-gap);
position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline;
}
}

.panel::backdrop{
background:transparent;
}


::slotted(hr){
border:none;
block-size:1px;
margin:var(--_space-inline-sm);
background:var(--_border-subtle);
}

@media (forced-colors:active){
.panel{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
}
}
`,vy=h`
    <span class="anchor" part="anchor">
        <slot
            name="trigger"
            @click="${t=>t.handleTriggerClick()}"
            @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
        ></slot>
    </span>
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
`,xo=class extends y{#e;#t=-1;#o="";#i=0;#r=new It;constructor(){super(),this.#e=Nh,Nh+=1,this.panelId=`violet-menu-panel-${this.#e}`,this.anchorName=Tt("violet-menu",this.#e),this.open=!1,this.label=""}connectedCallback(){super.connectedCallback(),this.#l(),this.#u()}disconnectedCallback(){this.#g(),this.#r.stop(this.#s),super.disconnectedCallback()}toggle(){this.#s?.togglePopover()}show(){this.#s?.showPopover()}hide(){this.#s?.matches(":popover-open")&&this.#s.hidePopover()}handleTriggerClick(){this.#s?.togglePopover()}handleTriggerKeydown(e){switch(e.key){case"ArrowDown":return e.preventDefault(),this.#p("first"),!1;case"ArrowUp":return e.preventDefault(),this.#p("last"),!1}return!0}handlePanelKeydown(e){let i=this.#a;if(i.length===0)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#f(this.#h(this.#t,1,i)),!1;case"ArrowUp":return e.preventDefault(),this.#f(this.#h(this.#t,-1,i)),!1;case"Home":return e.preventDefault(),this.#f(0),!1;case"End":return e.preventDefault(),this.#f(i.length-1),!1;case"Enter":case" ":{e.preventDefault();let o=i[this.#t];return o&&!o.disabled&&(o.$emit("invoke"),this.hide()),!1}case"Escape":return e.preventDefault(),this.hide(),this.#n?.focus(),!1;case"Tab":return this.hide(),!0;default:{if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){this.#m(e.key,i);break}return!0}}return!1}handleToggle(e){let i=e.newState==="open";this.open=i,i?(this.#l(),this.#c(),requestAnimationFrame(()=>{this.open&&this.#t===-1&&this.#f(0)})):(this.#r.stop(this.#s),this.#t=-1,this.#g()),this.#u(),this.$emit("open-change",{open:i})}handleItemsSlotChange(){this.#v()}openChanged(){if(!this.$fastController.isConnected)return;let e=this.#s;if(!e)return;let i=e.matches(":popover-open");this.open&&!i?e.showPopover():!this.open&&i&&e.hidePopover(),this.#u()}get#s(){return this.shadowRoot?.querySelector(".panel")??null}get#n(){return(this.shadowRoot?.querySelector('slot[name="trigger"]')?.assignedElements({flatten:!0})??[])[0]??null}get#a(){return Array.from(this.querySelectorAll("violet-menu-item"))}get#d(){return this.shadowRoot?.querySelector(".anchor")??null}#l(){$t(this.#d,null,this.#s,this.anchorName)}#c(){this.#r.start(()=>this.#n??this.#d??this,()=>this.#s,()=>["below","below","start",getComputedStyle(this).getPropertyValue("--_panel-gap"),this,4])}#u(){let e=this.#n;if(!e)return;e.setAttribute("aria-haspopup","menu"),e.setAttribute("aria-expanded",String(this.open));let i=this.shadowRoot;i&&"referenceTarget"in ShadowRoot.prototype?(i.referenceTarget=this.panelId,this.id||(this.id=`${this.panelId}-host`),e.setAttribute("aria-controls",this.id)):e.removeAttribute("aria-controls")}#p(e){let i=this.#s;if(!i)return;let o=this.#a;if(i.matches(":popover-open")){let r=e==="first"?1:-1;this.#f(this.#t===-1?e==="first"?0:o.length-1:this.#h(this.#t,r,o));return}i.showPopover(),this.#f(e==="first"?0:o.length-1)}#f(e){let i=this.#a;e<0||e>=i.length||(this.#t=e,i[e]?.focus())}#h(e,i,o){let r=o.length;if(r===0)return-1;let n=e+i;return n<0?n=r-1:n>=r&&(n=0),n}#m(e,i){this.#i&&clearTimeout(this.#i),this.#o+=e.toLowerCase(),this.#i=window.setTimeout(()=>{this.#g()},500);let o=this.#t+1;for(let r=0;r<i.length;r++){let n=(o+r)%i.length,s=i[n];if(s&&s.labelText.toLowerCase().startsWith(this.#o)){this.#f(n);return}}}#g(){this.#o="",this.#i&&(clearTimeout(this.#i),this.#i=0)}#v(){for(let e of this.#a)e.removeEventListener("invoke",this.#b),e.addEventListener("invoke",this.#b)}#b=()=>{let e=this.getRootNode(),i=this.contains(e.activeElement)||this.matches(":focus-within");this.hide(),i&&this.#n?.focus()}};fy([f],xo.prototype,"open",void 0);c(xo.prototype,"label");var Hh={name:"violet-menu",template:vy,styles:my};var gy=b`
    ${De}

:host{
display:flex;
--_surface-hover:var(--violet-color-surface-subtle,#e9e5de);
--_surface-pressed:var(--violet-color-surface-pressed,#d8dcd6);
}

.control{
box-sizing:border-box;
display:flex;
align-items:center;
gap:calc(var(--_space-inline-sm) * 2);
inline-size:100%;
min-block-size:var(--_target-size);
padding-inline:var(--_space-inline-md);
padding-block:0;
border:none;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
cursor:pointer;
font-family:inherit;
font-size:var(--_control-type-size);
line-height:var(--_type-body-line);
text-align:start;
white-space:nowrap;
transition:background-color var(--_duration-fast) var(--_easing-standard);
}

.control:hover:not([aria-disabled="true"]){
background:var(--_surface-hover);
}

.control:active:not([aria-disabled="true"]){
background:var(--_surface-pressed);
}

.control:focus-visible{
background:var(--_surface-hover);
outline:2px solid var(--_focus-ring);
outline-offset:-2px;
}

.control[aria-disabled="true"]{
color:var(--_text-secondary);
cursor:not-allowed;
opacity:0.5;
}

.control[aria-disabled="true"]:hover{
background:transparent;
}

slot[name="before"],
slot[name="after"]{
display:inline-flex;
align-items:center;
flex:0 0 auto;
}

.label{
flex:1 1 auto;
min-inline-size:0;
}

@media (forced-colors:active){
.control:hover:not([aria-disabled="true"]){
forced-color-adjust:none;
background:Highlight;
color:HighlightText;
}

.control:focus-visible{
outline-color:Highlight;
}

.control[aria-disabled="true"]{
color:GrayText;
}
}
`,by=h`
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
`,pr=class extends y{constructor(){super(),this.disabled=!1}handleClick(e){if(this.disabled){e.preventDefault(),e.stopPropagation();return}this.$emit("invoke")}get labelText(){return this.textContent?.trim()??""}};c({mode:"boolean"})(pr.prototype,"disabled");var jh={name:"violet-menu-item",template:by,styles:gy,shadowOptions:{delegatesFocus:!0}};var yy=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},qh=0,xy=b`
    ${A}

:host{
display:grid;
gap:var(--_space-stack-2xs);
}

.label{
padding-inline:calc(var(--_space-sm) * 1.5);
color:var(--_text-secondary);
font-size:var(--_caption-size);
font-weight:500;
line-height:var(--_caption-line);
}

:host([disabled]) .label{
color:var(--_text-muted);
}

.options{
display:grid;
gap:2px;
}

::slotted(violet-option){
--violet-option-padding-inline-start:calc(var(--_space-sm) * 3);
}
`,wy=h`
    ${g(t=>!!t.label,h`
            <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
        `)}
    <div class="options" part="options">
        <slot></slot>
    </div>
`,Di=class extends y{#e;constructor(){super(),this.#e=this.attachInternals(),this.label="",this.disabled=!1,qh+=1,this.labelId=`violet-option-group-label-${qh}`}connectedCallback(){super.connectedCallback(),this.#t()}labelChanged(){this.#t()}disabledChanged(){for(let e of this.querySelectorAll("violet-option"))e.closest("violet-option-group")===this&&(e.groupDisabled=this.disabled);this.$emit("group-state-change",{disabled:this.disabled})}#t(){this.#e.role="group",this.#e.ariaLabel=this.label||""}};yy([f],Di.prototype,"labelId",void 0);c(Di.prototype,"label");c({mode:"boolean"})(Di.prototype,"disabled");var Wh={name:"violet-option-group",template:wy,styles:xy};function Je(t){return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"")}function Me(t){let e=t.closest("violet-option-group");return!!(t.disabled||e?.disabled)}function wo(t){let e=t.localName,i=customElements.get("violet-option");return Array.from(t.querySelectorAll("violet-option")).filter(o=>o.closest(e)!==t?!1:(i&&!(o instanceof i)&&customElements.upgrade(o),!0))}function ce(t){return t.filter(e=>!Me(e))}function ct(t,e){return e===null?t.find(i=>i.selected&&!Me(i))??null:t.find(i=>i.value===e&&!Me(i))??null}function _o(t,e,i){if(t.length===0)return-1;let o=e;for(let r=0;r<t.length;r+=1)if(o=(o+i+t.length)%t.length,t[o]&&!Me(t[o]))return o;return-1}function Cn(t,e,i){let o=ce(t);if(o.length===0||!e)return null;let r=Je(e.trim()),n=i===null?-1:typeof i=="string"?o.findIndex(a=>a.value===i):o.indexOf(i);return(n>=0?[...o.slice(n+1),...o.slice(0,n+1)]:o).find(a=>Je(a.labelText).startsWith(r))??null}function ko(t){return e=>{let i=e.type.observedAttributes;i.includes(t)||i.push(t)}}function Co(t,e,i){i===null?t.hasAttribute(e)&&t.removeAttribute(e):t.getAttribute(e)!==i&&t.setAttribute(e,i)}function So(t,e,i,o){return e&&t.includes(e)?e:e?t.find(r=>r.value===e.value)??o:i!==""?t.find(r=>r.value===i)??o:o}function zo(t,e){for(let i of t.composedPath())if(i instanceof Element&&i.localName==="violet-option"){let o=i;return e.includes(o)&&!Me(o)?o:null}return null}function Eo(t,e,i){let o=new Set(e);for(let r of t)r.groupDisabled=!!r.closest("violet-option-group")?.disabled,r.selected=o.has(r),r.active=i!==null&&r===i}var Uh=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Kh=0,_y=b`
    ${De}


:host([hidden]){
display:none;
}

:host{
display:block;
--_surface-hover:var(--violet-color-surface-subtle,#e9e5de);
--_surface-active:var(--violet-color-surface-subtle,#e9e5de);
--_surface-selected:var(--violet-color-surface-selected,#dfecf4);
--_option-mark:var(--violet-color-control-selected-foreground,#1b5f80);
--_option-mark-size:0.6875rem;
--_focus-ring-width:var(--violet-size-focus-ring-width,2px);
--_control-caption-size:var(--violet-control-caption-size,var(--violet-type-caption-size,12px));
--_type-caption-line:var(--violet-type-caption-line,16px);
--_option-padding-inline-start:var(--violet-option-padding-inline-start,calc(var(--_space-inline-md) * 1.5));
--_option-padding-inline-end:var(--violet-option-padding-inline-end,calc(var(--_space-inline-md) * 1.5));
}

.control{
box-sizing:border-box;
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_space-inline-sm);
position:relative;
min-block-size:var(--_target-size);
padding-inline-start:var(--_option-padding-inline-start);

padding-inline-end:calc(var(--_option-padding-inline-end) + 1.25rem);
padding-block:var(--_space-inline-sm);
border:1px solid transparent;
border-radius:var(--_radius-md);
background:transparent;
color:inherit;
cursor:pointer;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard);
}






:host([active]) .control{
background:var(--violet-option-active-background,var(--_surface-active));
box-shadow:inset 0 0 0 var(--_focus-ring-width) var(--violet-option-active-ring,var(--_option-active-ring,transparent));
}

:host([selected]) .control{
background:var(--_surface-selected);
}



:host([active][selected]) .control{
background:var(--violet-option-active-background,var(--_surface-selected));
}


:host([selected]) .control::after{
content: "";
position:absolute;
inset-inline-end:calc(var(--_option-padding-inline-end) - 2px);
inset-block-start:calc(var(--_space-inline-sm) + (var(--_type-body-line) - var(--_option-mark-size)) / 2);
inline-size:var(--_option-mark-size);
block-size:var(--_option-mark-size);
background:var(--_option-mark);
clip-path:polygon(14% 44%,0 59%,37% 100%,100% 16%,84% 0,35% 62%);
}

.control:not(.disabled):hover{
background:var(--_surface-hover);
}


:host([active]) .control:not(.disabled):hover{
background:var(--violet-option-active-background,var(--_surface-hover));
}

.control.disabled{
color:var(--_text-secondary);
cursor:not-allowed;
opacity:0.5;
}

.before,
.after{
display:inline-flex;
align-items:center;
justify-content:center;
min-inline-size:0;
}

.content{
display:grid;
min-inline-size:0;
}

.label{
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
}

.description{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}


:host([selected]) .description{
color:var(--_text-secondary);
}

@media (forced-colors:active){
.control{
forced-color-adjust:none;
border-color:transparent;
background:Canvas;
color:ButtonText;
}

:host([active]) .control,
:host([active][selected]) .control,
:host([active]) .control:not(.disabled):hover,
:host([selected]) .control{
border-color:Highlight;
background:Highlight;
box-shadow:none;
color:HighlightText;
}

:host([selected]) .control::after{
background:HighlightText;
}

.control.disabled{
color:GrayText;
}
}
`,ky=h`
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
`,At=class extends y{#e=null;#t=!1;constructor(){super(),Kh+=1,this.optionId=`violet-option-${Kh}`,this.label="",this.selected=!1,this.active=!1,this.disabled=!1,this.groupDisabled=!1,this.hasDescription=!1}get value(){return T.track(this,"value"),this.#e??this.labelText}set value(e){let i=e==null?null:String(e),o=this.#e??this.labelText;this.#e=i,this.#o(i),o!==(this.#e??this.labelText)&&T.notify(this,"value")}attributeChangedCallback(e,i,o){if(e==="value"){if(!this.#t){let r=this.#e??this.labelText;this.#e=o,r!==(this.#e??this.labelText)&&T.notify(this,"value")}return}super.attributeChangedCallback(e,i,o)}connectedCallback(){super.connectedCallback(),this.#e===null&&this.hasAttribute("value")?this.#e=this.getAttribute("value"):this.#e!==null&&this.#o(this.#e),this.id||=this.optionId,this.setAttribute("role","option"),this.#i(),this.handleDescriptionSlotChange()}selectedChanged(){this.#i()}disabledChanged(){this.#i()}groupDisabledChanged(){this.#i()}labelChanged(){this.#e===null&&T.notify(this,"value")}handleDescriptionSlotChange(){let i=this.shadowRoot?.querySelector('slot[name="description"]')?.assignedNodes({flatten:!0}).some(o=>o.textContent?.trim());this.hasDescription=!!i}handleClick(e){if(this.isDisabled){e.preventDefault(),e.stopPropagation();return}this.$emit("request-select",{value:this.value})}get labelText(){return this.label?this.label:Array.from(this.childNodes).filter(i=>!(i instanceof HTMLElement&&i.slot)).map(i=>i.textContent??"").join(" ").replace(/\s+/g," ").trim()}get isDisabled(){return this.disabled||this.groupDisabled}#o(e){this.#t=!0;try{Co(this,"value",e)}finally{this.#t=!1}}#i(){this.isConnected&&(this.setAttribute("aria-selected",String(this.selected)),this.isDisabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled"))}};Uh([f],At.prototype,"hasDescription",void 0);Uh([f],At.prototype,"groupDisabled",void 0);c(At.prototype,"label");c({mode:"boolean"})(At.prototype,"selected");c({mode:"boolean"})(At.prototype,"active");c({mode:"boolean"})(At.prototype,"disabled");var Gh={name:"violet-option",template:ky,styles:_y},Yh=[ko("value")];var Qh=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Xh=0,Cy=b`
    ${A}

:host{
display:inline-flex;
--_persona-size:var(--violet-persona-size,32px);
--_persona-font-size:var(--violet-persona-font-size,12px);
}

:host([size="xs"]){
--_persona-size:var(--violet-persona-size,24px);
--_persona-font-size:var(--violet-persona-font-size,10px);
}

:host([size="sm"]){
--_persona-size:var(--violet-persona-size,32px);
--_persona-font-size:var(--violet-persona-font-size,12px);
}

:host([size="md"]){
--_persona-size:var(--violet-persona-size,40px);
--_persona-font-size:var(--violet-persona-font-size,14px);
}

:host([size="lg"]){
--_persona-size:var(--violet-persona-size,48px);
--_persona-font-size:var(--violet-persona-font-size,16px);
}

:host([size="xl"]){
--_persona-size:var(--violet-persona-size,64px);
--_persona-font-size:var(--violet-persona-font-size,20px);
}

.root{
box-sizing:border-box;
position:relative;
display:grid;
place-items:center;
inline-size:var(--_persona-size);
block-size:var(--_persona-size);
overflow:hidden;

border:1px solid transparent;
border-radius:var(--_radius-round);
background:var(--_tone-background,var(--_surface-subtle));
color:var(--_tone-foreground,var(--_text-primary));
font-size:var(--_persona-font-size);
font-weight:500;
line-height:1;
letter-spacing:0.02em;
text-transform:uppercase;
user-select:none;
-webkit-user-select:none;
}

.root[data-tone="moss"]{
--_tone-background:color-mix(in srgb,#b9d3b0 48%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.root[data-tone="sky"]{
--_tone-background:color-mix(in srgb,#b8d2eb 50%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.root[data-tone="amber"]{
--_tone-background:color-mix(in srgb,#e8d09c 52%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.root[data-tone="terracotta"]{
--_tone-background:color-mix(in srgb,#e2b29d 54%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.root[data-tone="plum"]{
--_tone-background:color-mix(in srgb,#cfbddb 54%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.root[data-tone="slate"]{
--_tone-background:color-mix(in srgb,#c8cfdb 56%,var(--_surface-card));
--_tone-foreground:var(--_text-primary);
}

.image{
inline-size:100%;
block-size:100%;
object-fit:cover;
display:block;
}

.fallback{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:100%;
block-size:100%;
}






.fallback::before{
content:attr(data-initials);
}

@media (forced-colors:active){
.root{
forced-color-adjust:none;
background:Canvas;
color:CanvasText;
border-color:ButtonText;
box-shadow:none;
}
}
`,Sy=h`
    <div
        class="root"
        part="root"
        data-tone="${t=>t.tone}"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
        aria-label="${t=>t.decorative?null:t.accessibleLabel}"
    >
        ${g(t=>!!t.src,h`
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
`,dt=class extends y{constructor(){super(),Xh+=1,this.personaId=`violet-persona-${Xh}`,this.label="",this.src="",this.initials="",this.decorative=!1,this.size="sm",this.imageFailed=!1,this.tone="moss"}connectedCallback(){super.connectedCallback(),this.syncTone()}labelChanged(){this.syncTone()}initialsChanged(){this.syncTone()}srcChanged(){this.imageFailed=!1}handleImageError(){this.imageFailed=!0}get accessibleLabel(){return T.trackVolatile(),this.label||this.displayInitials||"Persona"}get displayInitials(){return T.trackVolatile(),this.initials.trim()?this.initials.trim().slice(0,this.size==="xs"?1:3).toUpperCase():zy(this.label,this.size==="xs")||"?"}syncTone(){let e=this.label||this.initials||this.personaId||"",i=["moss","sky","amber","terracotta","plum","slate"],o=Array.from(e).reduce((r,n)=>r+n.charCodeAt(0),0);this.tone=i[o%i.length]??"moss"}};Qh([f],dt.prototype,"imageFailed",void 0);Qh([f],dt.prototype,"tone",void 0);function zy(t,e){let i=t.replace(/\s+/g," ").trim();if(!i)return"";let o=i.split(" ").map(r=>r.replace(/[^A-Za-z0-9]/g,"")).filter(Boolean);return o.length===0?"":e||o.length===1?o[0].charAt(0).toUpperCase():`${o[0].charAt(0)}${o.at(-1)?.charAt(0)??""}`.toUpperCase()}c(dt.prototype,"label");c(dt.prototype,"src");c(dt.prototype,"initials");c({mode:"boolean"})(dt.prototype,"decorative");c(dt.prototype,"size");var Jh={name:"violet-persona",template:Sy,styles:Cy};var zn={fromView(t){let e=Number.parseInt(t,10);return Number.isFinite(e)?e:0},toView(t){return String(t)}},Ey=b`
    ${De}

:host{
display:inline-flex;
max-inline-size:100%;
--_space-xs:var(--violet-space-stack-tight,4px);
--_space-layout-sm:var(--violet-space-layout-panel,12px);
--_text-primary:var(--violet-color-text-primary,#181b1a);
}

.nav{
display:inline-flex;
max-inline-size:100%;
}

.list{
display:inline-flex;
align-items:center;
flex-wrap:wrap;
gap:calc(var(--_space-xs) / 2);
margin:0;
padding:0;
list-style:none;
}

.item{
display:inline-flex;
align-items:center;
}

.button,
.ellipsis{
box-sizing:border-box;
min-inline-size:var(--_target-size);
min-block-size:var(--_target-size);
border-radius:var(--_radius-md);
font-family:inherit;
font-size:var(--_control-body-size);
font-variant-numeric:tabular-nums;
font-weight:var(--violet-type-body-weight,400);
line-height:var(--_type-body-line);
}

.button{
display:inline-flex;
align-items:center;
justify-content:center;
padding:0 var(--_space-inline-md);
border:1px solid transparent;
background:transparent;
color:var(--_text-secondary);
cursor:pointer;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard);
}

.button:hover{
background:var(--_action-secondary-background);
color:var(--_text-primary);
}

.button:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}


.button[aria-current="page"]{
background:var(--_action-secondary-background);
border-color:var(--_action-secondary-border);
color:var(--_text-primary);
font-weight:500;
}

.button[data-kind="nav"]{
padding-inline:var(--_space-layout-sm);
}

.button[disabled]{
opacity:0.5;
cursor:not-allowed;
}

.ellipsis{
display:inline-flex;
align-items:center;
justify-content:center;
padding:0 var(--_space-inline-md);
color:var(--_text-muted);
}

@media (forced-colors:active){
.button,
.ellipsis{
forced-color-adjust:none;
}

.button{
border-color:ButtonText;
color:ButtonText;
background:Canvas;
box-shadow:none;
}

.button[aria-current="page"]{
background:Highlight;
border-color:Highlight;
color:HighlightText;
}

.ellipsis{
color:ButtonText;
}
}
`,Ty=h`
    <nav class="nav" part="nav" aria-label="${t=>t.label}">
        <ol class="list" part="list"></ol>
    </nav>
`,Rt=class extends y{#e;constructor(){super(),this.#e=!1,this.label="Pagination",this.disabled=!1,this.page=1,this.pageCount=1,this.siblingCount=1,this.boundaryCount=1}connectedCallback(){super.connectedCallback(),this.#e=!0,this.page=Sn(this,"page",this.page||1),this.pageCount=Sn(this,"page-count",this.pageCount||1),this.siblingCount=Sn(this,"sibling-count",this.siblingCount||0),this.boundaryCount=Sn(this,"boundary-count",this.boundaryCount||0),this.#e=!1,this.#t(),this.#o()}pageChanged(){!this.isConnected||this.#e||(this.#t(),this.#o())}pageCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#o())}siblingCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#o())}boundaryCountChanged(){!this.isConnected||this.#e||(this.#t(),this.#o())}goPrevious(){this.goToPage(this.page-1)}goNext(){this.goToPage(this.page+1)}goToPage(e){if(this.disabled)return;let i=Zh(e,1,this.pageCount);i!==this.page&&(this.page=i,this.#o(),this.$emit("page-change",{page:this.page}),this.$emit("change"))}#t(){this.pageCount=Math.max(1,this.pageCount||1),this.siblingCount=Math.max(0,this.siblingCount||0),this.boundaryCount=Math.max(0,this.boundaryCount||0),this.page=Zh(this.page||1,1,this.pageCount)}#o(){let e=this.listElement;if(!e)return;let i=document.createDocumentFragment();i.append(this.#r("Previous","previous-button","Previous page",this.page<=1,()=>{this.goPrevious()}));for(let o of this.#i()){if(o.kind==="ellipsis"){i.append(this.#n());continue}i.append(this.#s(o.page,o.current))}i.append(this.#r("Next","next-button","Next page",this.page>=this.pageCount,()=>{this.goNext()})),e.replaceChildren(i)}#i(){return $y(this.page,this.pageCount,this.siblingCount,this.boundaryCount).map((i,o)=>i==="ellipsis"?{kind:"ellipsis",key:`ellipsis-${o}`}:{kind:"page",key:`page-${i}`,page:i,current:i===this.page})}#r(e,i,o,r,n){let s=document.createElement("li");s.className="item",s.setAttribute("part",i==="previous-button"?"item previous":"item next");let a=document.createElement("button");return a.className="button",a.type="button",a.dataset.kind="nav",a.setAttribute("part",`button ${i}`),a.setAttribute("aria-label",o),a.disabled=this.disabled||r,a.textContent=e,a.addEventListener("click",n),s.append(a),s}#s(e,i){let o=document.createElement("li");o.className="item",o.setAttribute("part","item page-item");let r=document.createElement("button");return r.className="button",r.type="button",r.setAttribute("part",i?"button current-button":"button page-button"),r.setAttribute("aria-label",i?`Page ${e}, current page`:`Go to page ${e}`),r.setAttribute("aria-current",i?"page":"false"),r.disabled=this.disabled||i,r.textContent=String(e),r.addEventListener("click",()=>this.goToPage(e)),o.append(r),o}#n(){let e=document.createElement("li");e.className="item",e.setAttribute("part","item ellipsis-item");let i=document.createElement("span");return i.className="ellipsis",i.setAttribute("part","ellipsis"),i.setAttribute("aria-hidden","true"),i.textContent="...",e.append(i),e}get listElement(){return this.shadowRoot?.querySelector(".list")??null}};c(Rt.prototype,"label");c({mode:"boolean"})(Rt.prototype,"disabled");c({attribute:"page",converter:zn})(Rt.prototype,"page");c({attribute:"page-count",converter:zn})(Rt.prototype,"pageCount");c({attribute:"sibling-count",converter:zn})(Rt.prototype,"siblingCount");c({attribute:"boundary-count",converter:zn})(Rt.prototype,"boundaryCount");var ep={name:"violet-pagination",template:Ty,styles:Ey};function $y(t,e,i,o){let r=ea(1,Math.min(o,e)),n=ea(Math.max(e-o+1,o+1),e),s=Math.max(Math.min(t-i,e-o-i*2-1),o+2),a=Math.min(Math.max(t+i,o+i*2+2),n.length>0?n[0]-2:e-1),l=[];return l.push(...r),s>o+2?l.push("ellipsis"):e>o+1&&l.push(o+1),l.push(...ea(s,a)),a<e-o-1?l.push("ellipsis"):e-o>o&&l.push(e-o),l.push(...n),Array.from(new Set(l))}function ea(t,e){return e<t?[]:Array.from({length:e-t+1},(i,o)=>t+o)}function Zh(t,e,i){return Math.min(Math.max(t,e),i)}function Sn(t,e,i){let o=t.getAttribute(e);if(!o)return i;let r=Number.parseInt(o,10);return Number.isFinite(r)?r:i}var tp=0,Iy=b`
    ${V}

:host{
display:grid;
gap:var(--_space-stack-xs);
color:var(--_text-secondary);
--_progress-track-size:6px;
--_progress-radius:var(--violet-radius-round,9999px);
--_progress-fill:var(--violet-color-control-selected-foreground,#1b5f80);

--_progress-track:color-mix(in srgb,var(--violet-color-text-primary,#181b1a) 10%,transparent);
}

.header{
display:flex;
align-items:baseline;
justify-content:space-between;
gap:var(--_space-inline-md);
}

.label,
.value-label{
margin:0;
font-size:var(--_control-label-size);
line-height:var(--_type-label-line);
}

.label{
color:var(--_text-secondary);
font-weight:var(--_type-label-weight);
}

.value-label{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
font-variant-numeric:tabular-nums;
}

.progress{
inline-size:100%;
block-size:var(--_progress-track-size);
overflow:hidden;
border:none;
border-radius:var(--_progress-radius);
background:var(--_progress-track);
appearance:none;
-webkit-appearance:none;
}

.progress::-webkit-progress-bar{
background:var(--_progress-track);
border-radius:var(--_progress-radius);
}

.progress::-webkit-progress-value{
border-radius:var(--_progress-radius);
background:var(--_progress-fill);
}

.progress::-moz-progress-bar{
border-radius:var(--_progress-radius);
background:var(--_progress-fill);
}

:host([value=""]) .progress{
position:relative;
background:var(--_progress-track);
}

:host([value=""]) .progress::before{
content: "";
position:absolute;
inset-block:0;
inline-size:35%;
border-radius:var(--_progress-radius);
background:var(--_progress-fill);
animation:indeterminate-slide 2.4s var(--_easing-standard) infinite;
}

@keyframes indeterminate-slide{
0%{
inset-inline-start:-35%;
}

100%{
inset-inline-start:100%;
}
}

@keyframes indeterminate-pulse{
0%{
opacity:1;
}


100%{
opacity:0.75;
}
}


@media (prefers-reduced-motion:reduce){
:host([value=""]) .progress::before{
inset-inline-start:0;
inline-size:100%;
animation:indeterminate-pulse 1.6s ease-in-out infinite alternate;
}
}

@media (forced-colors:active){
.progress{
forced-color-adjust:none;
background:Canvas;
border:1px solid ButtonText;
}

.progress::-webkit-progress-bar{
background:Canvas;
}

.progress::-webkit-progress-value,
.progress::-moz-progress-bar,
:host([value=""]) .progress::before{
background:Highlight;
}
}
`,Ay=h`
    ${g(t=>!!(t.label??"").trim()||t.showValueLabel,h`
            <div class="header" part="header">
                ${g(t=>!!(t.label??"").trim(),h`
                        <p class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</p>
                    `)}
                ${g(t=>t.showValueLabel,h`
                        <p class="value-label" part="value-label">${t=>t.valueLabel}</p>
                    `)}
            </div>
        `)}
    <progress
        class="progress"
        part="progress"
        max="${t=>t.normalizedMax}"
        value="${t=>t.progressValueAttribute}"
        aria-labelledby="${t=>(t.label??"").trim()?t.labelId:null}"
        aria-label="${t=>(t.label??"").trim()?null:"Progress"}"
        aria-valuetext="${t=>t.valueText||null}"
    ></progress>
`,fi=class extends y{constructor(){super();let e=tp;tp+=1,this.labelId=`violet-progress-label-${e}`,this.label="",this.value="0",this.max="100",this.valueText=""}get normalizedMax(){T.trackVolatile();let e=Number.parseFloat(this.max);return Number.isFinite(e)&&e>0?String(e):"100"}get progressValueAttribute(){if(T.trackVolatile(),this.value==="")return null;let e=Number.parseFloat(this.value);return Number.isFinite(e)?String(Math.min(Math.max(e,0),Number.parseFloat(this.normalizedMax))):"0"}get accessibleLabel(){return T.trackVolatile(),this.label||"Progress"}get showValueLabel(){return T.trackVolatile(),this.value!==""}get valueLabel(){if(T.trackVolatile(),!this.showValueLabel)return"";let e=Number.parseFloat(this.progressValueAttribute??"0"),i=Number.parseFloat(this.normalizedMax);return`${i>0?Math.round(e/i*100):0}%`}};c(fi.prototype,"label");c(fi.prototype,"value");c(fi.prototype,"max");c({attribute:"value-text"})(fi.prototype,"valueText");var ip={name:"violet-progress",template:Ay,styles:Iy};yo();var op=0,Ry=b`
    ${A}

:host{
display:inline-block;
position:relative;

--_popover-padding:var(--violet-popover-padding,var(--_space-md));
--_popover-min-inline:var(--violet-popover-min-inline-size,16rem);
--_popover-max-inline:var(--violet-popover-max-inline-size,min(24rem,calc(100vw - 24px)));
--_popover-radius:var(--violet-popover-radius,var(--_radius-lg));
--_popover-background:var(--violet-popover-background,var(--_surface-floating));
--_popover-shadow:var(--violet-popover-shadow,var(--_shadow-floating));

--_popover-border:var(--violet-popover-border,transparent);
--_popover-gap:var(--violet-popover-gap,var(--_space-sm));
}

.anchor{
display:inline-block;
}

.surface{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
min-inline-size:var(--_popover-min-inline);
max-inline-size:var(--_popover-max-inline);
padding:var(--_popover-padding);
border:1px solid var(--_popover-border);
border-radius:var(--_popover-radius);
background:var(--_popover-background);
box-shadow:var(--_popover-shadow);
color:inherit;
font-family:inherit;
z-index:var(--_layer-popover);

opacity:0;
transform:translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
transition:opacity,transform,display allow-discrete,overlay allow-discrete;
transition-duration:var(--_duration-fast);
transition-timing-function:var(--_easing-standard);
}

.surface:popover-open{
opacity:1;
transform:translateY(0) scale(1);

@starting-style{
opacity:0;
transform:translateY(calc(var(--_space-sm) * -0.5)) scale(0.98);
}
}

@supports (anchor-name:--a) and (position-area:block-end center) and (position-try-fallbacks:flip-block){
.surface{
position-area:block-end center;
margin-block-start:var(--_popover-gap);
position-try-fallbacks:flip-block;
}

:host([positioning="above"]) .surface{
position-area:block-start center;
margin-block:0 var(--_popover-gap);
}

:host([positioning="before"]) .surface{
position-area:center left;
margin-block-start:0;
margin-inline-end:var(--_popover-gap);
position-try-fallbacks:flip-inline;
}

:host([positioning="after"]) .surface{
position-area:center right;
margin-block-start:0;
margin-inline-start:var(--_popover-gap);
position-try-fallbacks:flip-inline;
}
}

.surface::backdrop{
background:transparent;
}

@media (forced-colors:active){
.surface{
forced-color-adjust:none;
background:Canvas;
color:CanvasText;
border-color:ButtonText;
box-shadow:none;
}
}
`,Dy=h`<span class="anchor" part="anchor"><slot name="trigger" @click="${t=>t.handleTriggerClick()}"></slot></span><div class="surface" part="surface" id="${t=>t.surfaceId}" popover="auto" @toggle="${(t,e)=>t.handleToggle(e.event)}"><slot></slot></div>`,Fi=class extends y{#e=null;#t=new It;constructor(){super();let e=op;op+=1,this.surfaceId=`violet-popover-${e}`,this.anchorName=Tt("violet-popover",e),this.open=!1,this.positioning="below",this.anchor=""}connectedCallback(){super.connectedCallback(),this.#n(),this.#s(),this.open&&this.show()}disconnectedCallback(){super.disconnectedCallback(),this.#t.stop(this.#r),this.#a()}openChanged(){this.$fastController.isConnected&&(this.open?this.show():this.hide())}positioningChanged(){this.open&&this.#t.update()}anchorChanged(){this.$fastController.isConnected&&(this.#a(),this.#n(),this.#s(),this.open&&this.#o())}show(){this.#r?.showPopover()}hide(){this.#r?.matches(":popover-open")&&this.#r.hidePopover()}toggle(){this.#r?.togglePopover()}handleTriggerClick(){this.toggle()}handleToggle(e){let i=e.newState==="open";this.open=i,i?(this.#s(),this.#o()):this.#t.stop(this.#r),this.$emit("open-change",{open:i})}#o(){this.#t.start(()=>this.#e??this.#i(".anchor"),()=>this.#r,()=>[this.positioning,"below","center",getComputedStyle(this).getPropertyValue("--_popover-gap"),this,8],!!this.#e)}#i(e){return this.shadowRoot?.querySelector(e)??null}get#r(){return this.#i(".surface")}#s(){$t(this.#i(".anchor"),this.#e,this.#r,this.anchorName)}#n(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#e=e,e.addEventListener("click",this.#d))}#a(){this.#e&&(this.#e.removeEventListener("click",this.#d),this.#e=null)}#d=()=>{this.toggle()}};c({mode:"boolean"})(Fi.prototype,"open");c(Fi.prototype,"positioning");c(Fi.prototype,"anchor");var rp={name:"violet-popover",template:Dy,styles:Ry};var ta=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Fy=b`
    ${V}

:host{
display:inline-grid;

--_selection-background:var(--violet-color-control-selected-background,#c0daeb);
--_selection-text:var(--violet-color-control-selected-foreground,#1b5f80);
--_selection-border:var(--violet-color-control-selected-border,rgba(27,95,128,0.5));
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_radius-full:999px;
--_size-font-md:var(--violet-type-body-size,14px);
--_control-size:max(var(--_size-font-md),calc(var(--_target-size) * 0.5));
--_dot-size:max(8px,calc(var(--_control-size) * 0.5));
--_type-body-line:var(--violet-type-body-line,20px);
--_type-caption-line:var(--violet-type-caption-line,16px);
}


:host(:focus-visible){
outline:none;
}

:host([inline]){
--_target-size:var(--violet-radio-inline-target-size,var(--_target-size-compact));
--_space-inline-sm:var(--violet-radio-inline-gap,4px);
}

.root{
display:inline-grid;
grid-template-columns:auto 1fr;
gap:var(--_space-inline-md);
align-items:start;
min-block-size:var(--_target-size);
cursor:pointer;
}

:host([inline]) .root{
grid-template-columns:auto;
gap:0;
align-items:center;
min-block-size:auto;
}

.control-shell{
position:relative;
display:inline-grid;
min-block-size:var(--_target-size);
align-items:center;
}

:host([inline]) .control-shell{
min-block-size:auto;
line-height:0;
}

.control{
box-sizing:border-box;
position:relative;
display:inline-grid;
place-items:center;
inline-size:var(--_control-size);
block-size:var(--_control-size);
border:1px solid var(--_border-strong);
border-radius:var(--_radius-full);
background:var(--_surface-card);
transition:
background-color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.dot{
position:absolute;
inset-inline-start:50%;
inset-block-start:50%;
inline-size:var(--_dot-size);
block-size:var(--_dot-size);
border-radius:var(--_radius-full);
background:var(--_selection-text);
opacity:0;
transform:translate(-50%,-50%) scale(0.72);
transform-origin:center;
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

:host([checked]) .control{
background:var(--_selection-background);
border-color:var(--_selection-border);
}

:host([checked]) .dot{
opacity:1;
transform:translate(-50%,-50%) scale(1);
}

:host(:not([checked]):not([disabled]):not([aria-disabled="true"])) .root:hover .control{
border-color:var(--_field-border-hover);
}

:host(:focus-visible) .control{
box-shadow:
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}


:host([invalid]) .control{
border-color:var(--_danger-border);
}

:host([disabled]) .root,
:host([aria-disabled="true"]) .root{
cursor:not-allowed;
}


:host([disabled]) :is(.control-shell,.label),
:host([aria-disabled="true"]) :is(.control-shell, .label){
opacity:0.5;
}





.content{
box-sizing:border-box;
display:grid;
gap:var(--_space-stack-2xs);
min-block-size:var(--_target-size);
padding-block:calc((var(--_target-size) - var(--_type-body-line)) / 2);
align-content:start;
}

.content[hidden]{
display:none;
}

:host([inline]) .content{
min-block-size:auto;
padding-block:0;
align-content:center;
}

.label{
color:var(--violet-color-text-primary,#181b1a);
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
overflow-wrap:break-word;
}

.supporting{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
overflow-wrap:break-word;
}

.supporting[hidden]{
display:none;
}

.error{
color:var(--_danger-text);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
overflow-wrap:break-word;
}

@media (forced-colors:active){
.control,
:host(:not([checked]):not([disabled]):not([aria-disabled="true"])) .root:hover .control{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
box-shadow:none;
}

:host([checked]) .control{
border-color:Highlight;
}

.dot{
forced-color-adjust:none;
background:Highlight;
}

:host(:focus-visible) .control{
outline:2px solid Highlight;
outline-offset:2px;
box-shadow:none;
}

:host([disabled]) .control,
:host([aria-disabled="true"]) .control{
border-color:GrayText;
}

:host([disabled]) .dot,
:host([aria-disabled="true"]) .dot{
background:GrayText;
}
}
`,My=h`
    <div class="root" part="root" @click="${(t,e)=>t.handleClick(e.event)}">
        <span class="control-shell">
            <span class="control" part="control" aria-hidden="true">
                <span class="dot" part="mark"></span>
            </span>
        </span>
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting&&!t.displayErrorText}">
            <span class="label" part="label" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </span>
            <span
                class="supporting"
                part="supporting-text"
                ?hidden="${t=>!t.hasSupporting||!!t.displayErrorText}"
            >
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
            ${g(t=>!!t.displayErrorText,h`
                    <span class="error" part="error-message" role="alert">${t=>t.displayErrorText}</span>
                `)}
        </span>
    </div>
`,Ve=class extends y{#e;#t;#o;#i;#r;#s;get displayErrorText(){return this._displayErrorText}constructor(){super(),this.#t=new MutationObserver(()=>this.#d()),this.#o=new MutationObserver(()=>this.#h()),this._displayErrorText="",this.handleKeydown=e=>{e.defaultPrevented||e.key!==" "&&e.key!=="Enter"||this.closest("violet-radio-group")||(e.preventDefault(),this.#l())},this.#e=this.attachInternals(),this.#e.role="radio",this.#i=null,this.#r=!1,this.#s=!1,this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.errorText="",this.name="",this.value="on"}connectedCallback(){super.connectedCallback(),this.setAttribute("role","radio"),this.addEventListener("keydown",this.handleKeydown),this.#a(),this.#s=io(this),this.#o.observe(this,{attributes:!0,attributeFilter:["aria-describedby"]}),this.#c(),this.#u(),this.#p(),this.#h(),this.#m()}disconnectedCallback(){this.removeEventListener("keydown",this.handleKeydown),this.#t.disconnect(),this.#o.disconnect(),this.#s=!1,super.disconnectedCallback()}get effectiveDisabled(){return this.disabled||this.#r||this.#s}setCheckedFromGroup(e){this.checked=e}setGroupDisabled(e){this.#r=e,this.#p(),this.#h(),this.#m()}get managedTabIndex(){return this.#i}set managedTabIndex(e){this.setManagedTabIndex(e)}setManagedTabIndex(e){this.#i=e,this.#m()}handleClick(e){e.preventDefault(),this.#l()}handleDefaultSlotChange(){this.#c(),this.#h()}handleSupportingSlotChange(){this.#u(),this.$fastController.isConnected&&M.enqueue(()=>{M.enqueue(()=>{this.#h()})})}checkedChanged(){this.#h(),this.#m()}disabledChanged(){this.#p(),this.#h(),this.#m()}invalidChanged(){this.#p(),this.#h()}errorTextChanged(){this.#p()}#n(e){this._displayErrorText!==e&&(this._displayErrorText=e,this.$fastController.isConnected&&M.enqueue(()=>{M.enqueue(()=>{this.#h()})}))}#a(){this.#t.disconnect();let e=this.parentNode;for(;e;)e instanceof HTMLFieldSetElement&&this.#t.observe(e,{attributes:!0,attributeFilter:["disabled"]}),e=e.parentNode}#d(){let e=io(this);this.#s!==e&&(this.#s=e,this.#p(),this.#h(),this.#m())}valueChanged(){this.#h()}get controlAriaLabel(){let e=this.getAttribute("aria-label");return e||this.#f()||null}#l(){this.effectiveDisabled||(this.focus(),!this.checked&&(this.checked=!0,this.$emit("change",{checked:!0,value:this.value})))}#c(){this.hasLabel=this.#f().length>0}#u(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#p(){this.#n(this.invalid&&!this.effectiveDisabled?(this.errorText??"").trim():"")}#f(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#h(){this.#e.ariaChecked=this.checked?"true":"false",this.#e.ariaDisabled=this.effectiveDisabled?"true":"false",this.#e.ariaInvalid=this.invalid?"true":"false";let e=this.shadowRoot?.querySelector(".label:not([hidden])"),i=this.shadowRoot?.querySelector(".error"),o=this.shadowRoot?.querySelector(".supporting:not([hidden])");if(e instanceof Element?(this.#e.ariaLabelledByElements=[e],this.#e.ariaLabel=null):(this.#e.ariaLabelledByElements=null,this.#e.ariaLabel=this.controlAriaLabel??null),this.hasAttribute("aria-describedby"))this.#e.ariaDescribedByElements=null,"ariaErrorMessageElements"in this.#e&&(this.#e.ariaErrorMessageElements=i instanceof Element?[i]:null);else{let r=i??o;this.#e.ariaDescribedByElements=r instanceof Element?[r]:null,"ariaErrorMessageElements"in this.#e&&(this.#e.ariaErrorMessageElements=null)}this.$fastController.isConnected&&this.setAttribute("aria-checked",this.checked?"true":"false"),this.effectiveDisabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled")}#m(){if(this.$fastController.isConnected){if(this.effectiveDisabled){this.tabIndex=-1;return}this.tabIndex=this.#i??0}}};ta([f],Ve.prototype,"hasSupporting",void 0);ta([f],Ve.prototype,"hasLabel",void 0);ta([f],Ve.prototype,"_displayErrorText",void 0);c({mode:"boolean"})(Ve.prototype,"checked");c({mode:"boolean"})(Ve.prototype,"disabled");c({mode:"boolean"})(Ve.prototype,"inline");c({mode:"boolean"})(Ve.prototype,"invalid");c({attribute:"error-text"})(Ve.prototype,"errorText");c(Ve.prototype,"name");c(Ve.prototype,"value");var np={name:"violet-radio",template:My,styles:Fy};var sp=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Vy=b`
    ${V}

:host{
display:grid;
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-stack-2xs);
}

.group{
display:flex;
flex-wrap:wrap;
gap:var(--_space-stack-sm) calc(var(--_space-inline-md) * 2);
align-items:start;
min-inline-size:0;
}

:host([orientation="vertical"]) .group{
flex-direction:column;
align-items:stretch;

gap:0;
}

.supporting{
margin:0;
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
margin-block-start:var(--_space-stack-xs);
}

.error{
margin:0;
color:var(--_danger-text);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
margin-block-start:var(--_space-stack-xs);
}
`,Oy=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
                <div class="label" part="label">${t=>t.label}</div>
            `)}
        <div class="group" part="group">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,ze=class extends y{static{this.formAssociated=!0}#e;#t;#o;constructor(){super(),this.handleRadioChange=e=>{let i=this.#d(e);i&&(this.#o||this.#a(i,{emitChange:!0,focus:!1}))},this.handleKeydown=e=>{let i=this.#d(e);if(!i||this.effectiveDisabled)return;let o=this.#s();if(!o.length)return;let r=o.indexOf(i);switch(fe(e.key,this)){case"ArrowDown":case"ArrowRight":{e.preventDefault();let n=r>=0?(r+1)%o.length:0;this.#a(o[n],{emitChange:!0,focus:!0});break}case"ArrowUp":case"ArrowLeft":{e.preventDefault();let n=r>=0?(r-1+o.length)%o.length:o.length-1;this.#a(o[n],{emitChange:!0,focus:!0});break}case"Home":{e.preventDefault(),this.#a(o[0],{emitChange:!0,focus:!0});break}case"End":{e.preventDefault(),this.#a(o[o.length-1],{emitChange:!0,focus:!0});break}case" ":case"Enter":{e.preventDefault(),this.#a(i,{emitChange:!0,focus:!0});break}default:break}},this.#e=this.attachInternals(),this.#e.role="radiogroup",this.#t="",this.#o=!1,this.radios=[],this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.disabled=!1,this.invalid=!1,this.required=!1,this.orientation="vertical"}connectedCallback(){super.connectedCallback(),this.addEventListener("change",this.handleRadioChange),this.addEventListener("keydown",this.handleKeydown),this.handleSlotChange(),this.#t=this.value,this.#l(),this.#u()}disconnectedCallback(){this.removeEventListener("change",this.handleRadioChange),this.removeEventListener("keydown",this.handleKeydown),super.disconnectedCallback()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#n()}handleSlotChange(){this.radios=this.#i(),this.#n()}radiosChanged(){this.#n()}labelChanged(){this.#c()}supportingTextChanged(){this.#c()}errorTextChanged(){this.#u()}valueChanged(){this.#o||this.#n()}nameChanged(){this.#n()}disabledChanged(){this.#n()}invalidChanged(){this.#l(),this.#u()}requiredChanged(){this.#l(),this.#u()}orientationChanged(){this.#l()}#i(){return Array.from(this.querySelectorAll("violet-radio")).filter(e=>e.closest("violet-radio-group")===this)}#r(){if(this.value){let e=this.radios.find(i=>i.value===this.value);if(e)return e}return this.radios.find(e=>e.checked)??null}#s(){return this.radios.filter(e=>!e.effectiveDisabled)}#n(e={}){if(!this.$fastController.isConnected)return;let i=this.#r(),o=i?.value??"",r=this.#s(),n=(!e.focusTarget||e.focusTarget.effectiveDisabled?null:e.focusTarget)??(i&&!i.effectiveDisabled?i:null)??r[0]??null;this.#o=!0,this.radios.forEach(s=>{customElements.upgrade(s),typeof s.setGroupDisabled=="function"&&(s.setGroupDisabled(this.effectiveDisabled),this.name&&(s.name=this.name),s.setCheckedFromGroup(!!i&&s===i),s.setManagedTabIndex(n&&s===n?0:-1))}),this.value=o,this.#o=!1,this.#l(),this.#u()}#a(e,i={}){if(!this.radios.includes(e)||e.effectiveDisabled)return;let o=this.value;this.value=e.value,this.#n({focusTarget:e}),i.focus&&e.focus(),i.emitChange&&this.value!==o&&this.$emit("change",{value:this.value})}#d(e){let i=e.composedPath();for(let o of i)if(o instanceof HTMLElement&&o.tagName.toLowerCase()==="violet-radio")return o;return null}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:this.required&&!this.value?"Please select an option.":""})}#l(){this.#e.ariaDisabled=this.effectiveDisabled?"true":"false",this.#e.ariaOrientation=this.orientation,this.#e.ariaRequired=this.required?"true":"false";let e=this.shadowRoot?.querySelector(".label"),i=this.shadowRoot?.querySelector(".supporting"),o=this.shadowRoot?.querySelector(".error");e instanceof Element&&!this.getAttribute("aria-label")?(this.#e.ariaLabelledByElements=[e],this.#e.ariaLabel=null):(this.#e.ariaLabelledByElements=null,this.#e.ariaLabel=this.getAttribute("aria-label")||this.label||null);let r=o instanceof Element?o:i instanceof Element?i:null;this.#e.ariaDescribedByElements=r?[r]:null,this.#e.ariaErrorMessageElements=o instanceof Element?[o]:null}#c(){M.enqueue(()=>M.enqueue(()=>this.#l()))}#u(){if(this.#e.setFormValue(this.effectiveDisabled||!this.value?null:this.value),this.effectiveDisabled){this.validationMessageText="",this.#e.setValidity({}),this.#e.ariaInvalid="false",this.#c();return}if(this.invalid){this.validationMessageText=this.displayErrorText,this.#e.setValidity({customError:!0},this.displayErrorText||"Please select a valid option."),this.#e.ariaInvalid="true",this.#c();return}if(this.validationMessageText="",this.required&&!this.value){this.#e.setValidity({valueMissing:!0},(this.errorText??"").trim()||"Please select an option."),this.#e.ariaInvalid="false",this.#c();return}this.validationMessageText="",this.#e.setValidity({}),this.#e.ariaInvalid="false",this.#c()}};sp([f],ze.prototype,"radios",void 0);sp([f],ze.prototype,"validationMessageText",void 0);c(ze.prototype,"label");c({attribute:"supporting-text"})(ze.prototype,"supportingText");c({attribute:"error-text"})(ze.prototype,"errorText");c(ze.prototype,"value");c(ze.prototype,"name");c({mode:"boolean"})(ze.prototype,"disabled");G(ze.prototype);c({mode:"boolean"})(ze.prototype,"invalid");c({mode:"boolean"})(ze.prototype,"required");c(ze.prototype,"orientation");var ap={name:"violet-radio-group",template:Oy,styles:Vy,shadowOptions:{delegatesFocus:!0}};var cp=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},lp=0,Ly=b`
    ${A}

:host{
display:grid;
--_panel-min-inline:var(--violet-listbox-min-inline-size,14rem);
--_panel-max-block:var(--violet-listbox-max-block-size,18rem);

--_space-inline-sm:var(--violet-space-inline-tight,4px);
--_panel-padding:var(--violet-listbox-padding,var(--_space-inline-sm));
}

.control{
box-sizing:border-box;
display:grid;
gap:2px;
min-inline-size:var(--_panel-min-inline);
max-block-size:min(var(--_panel-max-block),70vh);
overflow:auto;
padding:var(--_panel-padding);

border:1px solid transparent;
border-radius:var(--_radius-lg);
background:var(--_surface-card);
box-shadow:var(--_shadow-card);
outline:none;
}

.control:focus-visible{

--_option-active-ring:var(--_focus-ring);
box-shadow:
var(--_shadow-card),
0 0 0 2px var(--_focus-ring);
}

:host([disabled]) .control{
opacity:0.5;
cursor:not-allowed;
}

@media (forced-colors:active){
.control{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
box-shadow:none;
}

.control:focus-visible{
border-color:Highlight;
box-shadow:0 0 0 2px Highlight;
}
}
`,Py=h`
    <div
        id="${t=>t.listboxId}"
        class="control"
        part="control"
        role="listbox"
        tabindex="${t=>t.disabled?"-1":"0"}"
        aria-disabled="${t=>String(t.disabled)}"
        aria-multiselectable="${t=>t.multiple?"true":null}"
        aria-label="${t=>t.label||t.getAttribute("aria-label")||"Options"}"
        @pointerdown="${t=>t.handlePointerDown()}"
        @focus="${t=>t.handleFocus()}"
        @keydown="${(t,e)=>t.handleKeydown(e.event)}"
    >
        <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
    </div>
`,Dt=class extends y{#e=!1;#t=null;#o=[];#i=null;#r=!1;#s=!1;#n=!1;#a="";#d=0;constructor(){super(),lp+=1,this.listboxId=`violet-listbox-${lp}`,this.label="",this.activeValue="",this.selectedValues=[],this.disabled=!1,this.multiple=!1,this.selectionFollowsFocus=!1}get value(){return T.track(this,"value"),this.#t??""}set value(e){let i=e==null?null:String(e);this.#u(i,!0)}attributeChangedCallback(e,i,o){if(e==="value"){this.#r||this.#u(o,!1);return}super.attributeChangedCallback(e,i,o)}connectedCallback(){super.connectedCallback(),this.#t===null&&this.hasAttribute("value")?this.#t=this.getAttribute("value"):this.#t!==null&&this.#f(this.#t),this.addEventListener("request-select",this.handleRequestSelect),this.handleSlotChange()}disconnectedCallback(){this.removeEventListener("request-select",this.handleRequestSelect),super.disconnectedCallback()}get options(){return wo(this)}get activeOptionId(){return this.#i?.optionId??""}handleSlotChange(){let e=this.options,i=ce(e),o=null;if(this.multiple){let n=new Set(this.selectedValues),s=this.#o.filter(u=>i.includes(u)&&n.has(u.value)),a=new Set(s.map(u=>u.value)),l=i.filter(u=>n.has(u.value)&&!a.has(u.value)),d=this.selectedValues.length>0?i.filter(u=>s.includes(u)||l.includes(u)):this.#o.length>0?[]:i.filter(u=>u.selected);this.#o=d,o=d[0]??null,this.#n=!0;try{this.selectedValues=d.map(u=>u.value),this.#p(d[0]?.value??null,!0)}finally{this.#n=!1}}else{let n=this.#o[0],s=n&&i.includes(n)&&(n.value===this.#t||!n.hasAttribute("value"))?n:ct(e,this.#t);this.#o=s?[s]:[],o=s,this.#n=!0;try{s&&(this.#t===null||n===s)&&this.#p(s.value,!0),this.selectedValues=s?[s.value]:[]}finally{this.#n=!1}}let r=So(i,this.#i,this.activeValue,o??i[0]??null);this.#g(r)}handleFocus(){if(this.disabled)return;let e=ce(this.options);if(!this.#i||!e.includes(this.#i)){let o=this.#o.find(r=>e.includes(r))??null;this.#g(o??e[0]??null)}else this.#_();let i=this.#e;this.#e=!1,i||this.#b()}handlePointerDown(){return this.#e=!0,window.setTimeout(()=>{this.#e=!1}),!0}handleKeydown(e){if(this.disabled)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#h(1),!1;case"ArrowUp":return e.preventDefault(),this.#h(-1),!1;case"Home":return e.preventDefault(),this.#m(ce(this.options)[0]??null),!1;case"End":{e.preventDefault();let i=ce(this.options);return this.#m(i.at(-1)??null),!1}case"Enter":case" ":return e.preventDefault(),this.#i&&!Me(this.#i)&&(this.multiple?this.#c(this.#i):this.#l(this.#i)),!1;case"a":case"A":return this.multiple&&(e.ctrlKey||e.metaKey)?(e.preventDefault(),this.toggleAll(),!1):!0;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#v(e.key),!0}}handleRequestSelect(e){e.stopPropagation();let i=zo(e,this.options);if(i){this.multiple?this.#c(i):this.#l(i);return}let o=e.detail?.value??"";this.multiple?this.toggleValue(o):this.selectValue(o)}activeValueChanged(){this.#s||!this.$fastController.isConnected||(this.#i=ce(this.options).find(e=>e.value===this.activeValue)??null,this.#_())}selectedValuesChanged(){if(this.#n||!this.$fastController.isConnected||!this.multiple)return;let e=ce(this.options),i=new Set(this.selectedValues);this.#o=e.filter(o=>i.has(o.value)),this.#n=!0;try{this.#p(this.selectedValues.length>0?this.selectedValues[0]??null:null,!0)}finally{this.#n=!1}this.#_()}selectValue(e,i=!0){let o=ce(this.options).find(r=>r.value===e)??null;o&&this.#l(o,i)}toggleValue(e,i=!0){let o=ce(this.options).find(r=>r.value===e)??null;o&&this.#c(o,i)}toggleAll(){let e=ce(this.options),i=e.every(o=>this.#o.includes(o));this.#o=i?[]:[...e],this.#n=!0;try{this.selectedValues=this.#o.map(o=>o.value),this.#p(this.#o[0]?.value??null,!0)}finally{this.#n=!1}this.#g(e[0]??null),this.$emit("input",{value:this.value,selectedValues:[...this.selectedValues]}),this.$emit("change",{value:this.value,selectedValues:[...this.selectedValues]})}#l(e,i=!0){this.#o=[e],this.#n=!0;try{this.#p(e.value,!0),this.selectedValues=[e.value]}finally{this.#n=!1}this.#g(e),i&&(this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value}))}#c(e,i=!0){let o=new Set(this.#o);o.has(e)?o.delete(e):o.add(e),this.#o=this.options.filter(r=>o.has(r)),this.#n=!0;try{this.selectedValues=this.#o.map(r=>r.value),this.#p(this.#o[0]?.value??null,!0)}finally{this.#n=!1}this.#g(e),i&&(this.$emit("input",{value:this.value,selectedValues:[...this.selectedValues]}),this.$emit("change",{value:this.value,selectedValues:[...this.selectedValues]}))}#u(e,i){if(this.#p(e,i),!!this.$fastController.isConnected){if(!this.multiple){let o=e===null?null:ct(this.options,e);this.#o=o?[o]:[],this.#n=!0;try{this.selectedValues=o?[o.value]:[]}finally{this.#n=!1}}this.#_()}}#p(e,i){let o=this.#t??"";this.#t=e,i&&this.#f(e),o!==(e??"")&&T.notify(this,"value")}#f(e){this.#r=!0;try{Co(this,"value",e)}finally{this.#r=!1}}#h(e){let i=this.options,o=this.#i?i.indexOf(this.#i):-1,r=_o(i,o<0?e===1?-1:0:o,e);this.#m(r>=0?i[r]??null:null)}#m(e){this.#g(e),this.#b(),!this.multiple&&this.selectionFollowsFocus&&e&&this.#l(e)}#g(e){this.#i=e,this.#_(),this.#s=!0;try{this.activeValue=e?.value??""}finally{this.#s=!1}}#v(e){window.clearTimeout(this.#d),this.#a=`${this.#a}${e.toLowerCase()}`;let i=Cn(this.options,this.#a,this.#i);i&&this.#m(i),this.#d=window.setTimeout(()=>{this.#a=""},500)}#b(){this.#i?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#_(){Eo(this.options,this.#o,this.#i);let e=this.shadowRoot?.querySelector('[role="listbox"]');e&&(e.ariaActiveDescendantElement=this.#i)}};cp([f],Dt.prototype,"activeValue",void 0);cp([f],Dt.prototype,"selectedValues",void 0);c(Dt.prototype,"label");c({mode:"boolean"})(Dt.prototype,"disabled");c({mode:"boolean"})(Dt.prototype,"multiple");c({mode:"boolean",attribute:"selection-follows-focus"})(Dt.prototype,"selectionFollowsFocus");var dp={name:"violet-listbox",template:Py,styles:Ly,shadowOptions:{delegatesFocus:!0}},up=[ko("value")];var ia=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Mi=0;function hp(t){return t.isComposing||t.keyCode===229}var By=b`
    ${V}

:host{
position:relative;
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
}

.field{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
gap:0;
}

.control-shell{
position:relative;
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
}

.control-shell.open{
z-index:var(--_layer-raised);
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.trigger{
box-sizing:border-box;
display:flex;
align-items:center;
gap:var(--_space-inline-sm);
inline-size:100%;
min-inline-size:0;
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
cursor:pointer;
font-family:inherit;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
text-align:start;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.trigger:hover{
box-shadow:var(--_field-shadow-hover);
}

.trigger:focus-visible,
.control-shell.open .trigger{
outline:none;
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .trigger,
:host(:disabled) .trigger{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .trigger{
border-color:var(--_danger-border);
}

.value{
flex:1 1 auto;
min-inline-size:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.value[data-placeholder="true"]{
color:var(--_field-placeholder);
}

.caret{
inline-size:0.4375rem;
block-size:0.4375rem;
flex:0 0 auto;
margin-inline-end:2px;
border-inline-end:1.5px solid currentColor;
border-block-end:1.5px solid currentColor;
color:var(--_text-muted);
transform:translateY(-1px) rotate(45deg);
}






.panel{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
z-index:var(--_layer-popover);
inline-size:var(--_panel-inline-size,auto);
max-inline-size:calc(100vw - 8px);
max-block-size:min(18rem,60vh);
padding:var(--_space-inline-sm);

border:thin solid transparent;
border-radius:var(--_radius-lg);
overflow:hidden;
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
color:inherit;
}

.panel[hidden]{
display:none;
}

.listbox{

--_option-active-ring:var(--_focus-ring);
display:grid;
gap:2px;
max-block-size:inherit;
overflow:auto;
outline:none;
}

.listbox:focus-visible{
outline:none;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

.control-shell.open ~ .supporting,
.control-shell.open ~ .error{
visibility:hidden;
}

@media (forced-colors:active){
.trigger,
.trigger:hover,
.panel{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
box-shadow:none;
}

.trigger:focus-visible,
.control-shell.open .trigger{
box-shadow:0 0 0 2px Highlight;
border-color:Highlight;
}
}
`,Ny=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
                aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
                @click="${t=>t.handleTriggerClick()}"
                @keydown="${(t,e)=>t.handleTriggerKeydown(e.event)}"
            >
                <span id="${t=>t.valueId}" class="value" data-placeholder="${t=>String(!t.selectedLabel&&!t.value)}">
                    ${t=>t.selectedLabel||t.value||t.placeholder||"Select an option"}
                </span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </button>

            <div class="panel" part="panel" popover="manual" hidden>
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

        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,ke=class extends y{static{this.formAssociated=!0}#e;#t=null;#o=null;#i=null;#r=null;#s=!1;#n=!1;#a="";#d=0;#l=()=>{this.open&&this.#z()};#c=e=>{this.open&&(e.composedPath().includes(this)||this.hide())};#u=e=>{this.handleControlFocusOut(e)};#p=new MutationObserver(e=>{e.some(i=>i.target!==this)&&this.handleSlotChange()});constructor(){super(),this.#e=this.attachInternals(),this.open=!1,this.validationMessageText="",this.label="",this.placeholder="",this.supportingText="",this.errorText="",this.activeValue="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,Mi+=1,this.triggerId=`violet-select-trigger-${Mi}`,this.labelId=`violet-select-label-${Mi}`,this.valueId=`violet-select-value-${Mi}`,this.listboxId=`violet-select-listbox-${Mi}`,this.supportingId=`violet-select-supporting-${Mi}`,this.errorId=`violet-select-error-${Mi}`}get value(){return T.track(this,"value"),this.#t??""}set value(e){let i=e==null?null:String(e);this.#S(i,!0)}attributeChangedCallback(e,i,o){if(e==="value"){this.#s||this.#S(o,!1);return}super.attributeChangedCallback(e,i,o)}connectedCallback(){super.connectedCallback(),this.#t===null&&this.hasAttribute("value")?this.#t=this.getAttribute("value"):this.#t!==null&&this.#y(this.#t),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.addEventListener("request-select",this.handleRequestSelect),this.addEventListener("focusout",this.#u),this.ownerDocument.addEventListener("pointerdown",this.#c,!0),window.addEventListener("resize",this.#l),window.addEventListener("scroll",this.#l,!0),this.#p.observe(this,{childList:!0,subtree:!0,characterData:!0,attributes:!0,attributeFilter:["value","label","disabled"]}),this.handleSlotChange(),this.#o=this.#t,this.#w(),this.openChanged()}disconnectedCallback(){this.#p.disconnect(),this.removeEventListener("request-select",this.handleRequestSelect),this.removeEventListener("focusout",this.#u),this.ownerDocument.removeEventListener("pointerdown",this.#c,!0),window.removeEventListener("resize",this.#l),window.removeEventListener("scroll",this.#l,!0),super.disconnectedCallback()}get options(){return wo(this)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get selectedLabel(){return T.track(this,"selectedLabel"),this.#i?.labelText??""}get activeOptionId(){return this.#r?.optionId??""}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get displayErrorText(){return T.track(this,"displayErrorText"),Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:this.required&&this.#i===null&&!this.value?"Please select an option.":""})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.#i=null,this.options.forEach(e=>{e.selected=!1}),this.#S(this.#o,!0),this.handleSlotChange()}handleSlotChange(){let e=this.options,i=ce(e),o=null;this.#i&&i.includes(this.#i)&&(this.#i.value===this.#t||!this.#i.hasAttribute("value"))?(o=this.#i,this.#t!==o.value&&(this.#t=o.value,this.#y(this.#t),T.notify(this,"value"))):(o=ct(e,this.#t),this.#i=o,this.#t===null&&o&&(this.#t=o.value,this.#y(this.#t),T.notify(this,"value")));let r=So(i,this.#r,this.activeValue,o??i[0]??null);this.#v(r),this.#w(),T.notify(this,"selectedLabel")}handleTriggerClick(){this.effectiveDisabled||(this.open?this.hide():this.show())}handleTriggerKeydown(e){if(hp(e)||this.effectiveDisabled)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.show(),this.#m(1),!1;case"ArrowUp":return e.preventDefault(),this.show(),this.#m(-1),!1;case"Enter":case" ":return e.preventDefault(),this.show(),!1;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#b(e.key),!0}}handleListboxKeydown(e){if(hp(e)||!this.open)return!0;switch(e.key){case"ArrowDown":return e.preventDefault(),this.#m(1),!1;case"ArrowUp":return e.preventDefault(),this.#m(-1),!1;case"Home":return e.preventDefault(),this.#g(ce(this.options)[0]??null),!1;case"End":{e.preventDefault();let i=ce(this.options);return this.#g(i.at(-1)??null),!1}case"Enter":case" ":{let i=this.#r&&!Me(this.#r)?this.#r:null;return i?(e.preventDefault(),this.#f(i),!1):!0}case"Escape":return e.preventDefault(),this.hide(),this.#h(),!1;case"Tab":return!0;default:return e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&this.#b(e.key),!0}}handleControlFocusOut(e){let i=e.relatedTarget;return i&&(i===this||this.shadowRoot?.contains(i)||this.contains(i))||this.hide(),!0}handleRequestSelect(e){e.stopPropagation();let i=zo(e,this.options);if(i){this.#f(i);return}let o=e.detail?.value??"";this.selectValue(o)}activeValueChanged(){this.#n||!this.$fastController.isConnected||(this.#r=ce(this.options).find(e=>e.value===this.activeValue)??null,this.#I())}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name)}openChanged(){let e=this.#E,i=this.#$,o=this.#k,r=this.#C;e?.classList.toggle("open",this.open),i?.toggleAttribute("hidden",!this.open),i?.isConnected&&i.matches(":popover-open")!==this.open&&(this.open?i.showPopover():i.hidePopover()),this.open&&this.#z(),o?.setAttribute("aria-expanded",String(this.open)),o&&(o.tabIndex=this.open?-1:0),r&&(r.tabIndex=this.open?0:-1,this.open&&requestAnimationFrame(()=>{this.#z(),this.#C?.focus(),this.#_()}))}requiredChanged(){this.#w()}disabledChanged(){this.#w()}invalidChanged(){this.#w()}errorTextChanged(){this.#w()}show(){if(this.effectiveDisabled||this.open)return;this.open=!0;let e=ce(this.options),i=this.#i&&e.includes(this.#i)?this.#i:null;this.#v(i??e[0]??null)}hide(){this.open=!1}selectValue(e){let i=ce(this.options).find(o=>o.value===e)??null;i&&this.#f(i)}#f(e){this.#i=e,this.#t=e.value,this.#y(this.#t),this.hide(),this.#v(e),this.#w(),T.notify(this,"value"),T.notify(this,"selectedLabel"),this.$emit("input",{value:this.value}),this.$emit("change",{value:this.value}),this.#h()}#h(){this.#k?.focus()}#m(e){let i=this.options,o=this.#r?i.indexOf(this.#r):-1,r=_o(i,o<0?e===1?-1:0:o,e);this.#g(r>=0?i[r]??null:null)}#g(e){this.#v(e),this.#_()}#v(e){this.#r=e,this.#I(),this.#n=!0;try{this.activeValue=e?.value??""}finally{this.#n=!1}}#b(e){window.clearTimeout(this.#d),this.#a=`${this.#a}${e.toLowerCase()}`;let i=Cn(this.options,this.#a,this.#r);i&&(this.open?this.#g(i):this.#f(i)),this.#d=window.setTimeout(()=>{this.#a=""},500)}#_(){this.#r?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#z(){let e=this.#$,i=this.#k;if(!e||!i)return;let o=i.getBoundingClientRect(),r=4,n=-1,s=o.left,a=o.bottom+n,l=Math.min(o.width,window.innerWidth-r*2);e.style.width=`${l}px`,e.style.left=`${Math.max(r,s)}px`,e.style.top=`${Math.max(r,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-r&&(s=Math.max(r,window.innerWidth-d.width-r)),d.bottom>window.innerHeight-r&&(a=Math.max(r,o.top-d.height+1)),e.style.left=`${s}px`,e.style.top=`${a}px`})}get#E(){return this.shadowRoot?.querySelector(".control-shell")??null}get#$(){return this.shadowRoot?.querySelector(".panel")??null}get#C(){return this.shadowRoot?.querySelector('[role="listbox"]')??null}get#k(){return this.shadowRoot?.querySelector(".trigger")??null}#S(e,i){let o=this.#t??"";this.#t=e,i&&this.#y(e),this.$fastController.isConnected&&(this.#i=e===null?null:ct(this.options,e),this.#I(),this.#w()),o!==(e??"")&&T.notify(this,"value"),T.notify(this,"selectedLabel")}#y(e){this.#s=!0;try{Co(this,"value",e)}finally{this.#s=!1}}#I(){Eo(this.options,this.#i?[this.#i]:[],this.#r);let e=this.#C;e&&(e.ariaActiveDescendantElement=this.#r)}#w(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector(".trigger"),i=this.displayErrorText,o=i||(this.errorText??"").trim()||"Please select an option.",r=!this.effectiveDisabled&&this.invalid,n=this.effectiveDisabled?null:this.#i?this.#i.value:this.value||null;if(this.validationMessageText!==i&&(this.validationMessageText=i,T.notify(this,"displayErrorText")),this.#e.ariaInvalid=r?"true":"false",this.#e.setFormValue(n,n),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},o,e??void 0);return}if(this.required&&this.#i===null&&!this.value){this.#e.setValidity({valueMissing:!0},o,e??void 0);return}this.#e.setValidity({})}};ia([f],ke.prototype,"open",void 0);ia([f],ke.prototype,"validationMessageText",void 0);ia([f],ke.prototype,"activeValue",void 0);c(ke.prototype,"label");c(ke.prototype,"placeholder");c({attribute:"supporting-text"})(ke.prototype,"supportingText");c({attribute:"error-text"})(ke.prototype,"errorText");c(ke.prototype,"name");c({mode:"boolean"})(ke.prototype,"required");c({mode:"boolean"})(ke.prototype,"disabled");G(ke.prototype);c({mode:"boolean"})(ke.prototype,"invalid");c({mode:"boolean"})(ke.prototype,"open");var pp={name:"violet-select",template:Ny,styles:By,shadowOptions:{delegatesFocus:!0}},fp=[ko("value")];var En=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},To=0,Hy=b`
    ${V}

:host{
position:relative;
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
}

.field{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
gap:0;
}

.control-shell{
position:relative;
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
}

.control-shell.open{
z-index:var(--_layer-raised);
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-frame{
box-sizing:border-box;
display:flex;
align-items:center;
gap:var(--_space-inline-sm);
inline-size:100%;
min-inline-size:0;
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control-frame:hover{
box-shadow:var(--_field-shadow-hover);
}

.control-frame:focus-within,
.control-shell.open .control-frame{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .control-frame{
border-color:var(--_danger-border);
}

.input{
flex:1 1 auto;
min-inline-size:0;
border:0;
background:transparent;
color:inherit;
font:inherit;
font-size:var(--_control-body-size);
line-height:1;
outline:none;
}

.input::placeholder{
color:var(--_field-placeholder);
}

.caret{
inline-size:0.4375rem;
block-size:0.4375rem;
flex:0 0 auto;
margin-inline-end:2px;
border-inline-end:1.5px solid currentColor;
border-block-end:1.5px solid currentColor;
color:var(--_text-muted);
transform:translateY(-1px) rotate(45deg);
pointer-events:none;
}






.panel{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
z-index:var(--_layer-popover);
inline-size:var(--_panel-inline-size,auto);
max-inline-size:calc(100vw - 8px);
max-block-size:min(18rem,60vh);
padding:var(--_space-inline-sm);

border:thin solid transparent;
border-radius:var(--_radius-lg);
overflow:hidden;
background:var(--_surface-floating);
box-shadow:var(--_shadow-floating);
color:inherit;
}

.panel[hidden]{
display:none;
}

.listbox{

--_option-active-ring:var(--_focus-ring);
display:grid;
gap:2px;
max-block-size:inherit;
overflow:auto;
}

.empty{
padding:var(--_space-inline-sm) var(--_space-inline-md);
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

.control-shell.open ~ .supporting,
.control-shell.open ~ .error{
visibility:hidden;
}

@media (forced-colors:active){
.control-frame{
border-color:ButtonText;
}

.control-frame:focus-within,
.control-shell.open .control-frame{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
border-color:GrayText;
}
}
`,jy=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
                <div class="label" part="label" id="${t=>t.labelId}">${t=>t.label}</div>
            `)}
        <div class="control-shell" part="control-shell">
            <div class="control-frame" part="control-frame" @click="${t=>t.handleControlClick()}">
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
                    aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
                    @focus="${t=>t.handleInputFocus()}"
                    @focusout="${(t,e)=>t.handleFocusOut(e.event)}"
                    @input="${(t,e)=>t.handleInput(e.event)}"
                    @change="${(t,e)=>t.handleCommit(e.event)}"
                    @keydown="${(t,e)=>t.handleKeydown(e.event)}"
                />
                <span class="caret" part="caret" aria-hidden="true"></span>
            </div>

            <div class="panel" part="panel" popover="manual" hidden>
                <div
                    id="${t=>t.listboxId}"
                    class="listbox"
                    part="listbox"
                    role="listbox"
                    aria-label="${t=>t.label||t.placeholder||"Options"}"
                >
                    <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
                </div>
                ${g(t=>t.visibleOptions.length===0,h`
                        <div class="empty" part="empty-state">No matching options</div>
                    `)}
            </div>
        </div>

        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,de=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i=!1;#r=null;#s=null;#n=null;#a=!1;#d=!1;#l=!1;#c=()=>{this.open&&this.#z()};#u=e=>{this.open&&(e.composedPath().includes(this)||this.hide(!0))};#p=new MutationObserver(e=>{e.some(i=>i.target!==this)&&this.handleSlotChange()});constructor(){super(),this.#e=this.attachInternals(),this.#t="",this.#o=null,this.open=!1,this.validationMessageText="",this.label="",this.placeholder="",this.supportingText="",this.errorText="",this.value="",this.activeValue="",this.selectedOptionValue="",this.name="",this.required=!1,this.disabled=!1,this.invalid=!1,this.openOnFocus=!1,To+=1,this.inputId=`violet-combobox-input-${To}`,this.labelId=`violet-combobox-label-${To}`,this.listboxId=`violet-combobox-listbox-${To}`,this.supportingId=`violet-combobox-supporting-${To}`,this.errorId=`violet-combobox-error-${To}`}connectedCallback(){super.connectedCallback(),this.addEventListener("request-select",this.handleRequestSelect),this.ownerDocument.addEventListener("pointerdown",this.#u,!0),window.addEventListener("resize",this.#c),window.addEventListener("scroll",this.#c,!0),this.#p.observe(this,{childList:!0,subtree:!0,characterData:!0,attributes:!0,attributeFilter:["value","label","disabled"]}),this.#i=this.hasAttribute("value")&&this.getAttribute("value")==="",this.#a=this.#i,this.handleSlotChange(),this.#t=this.getAttribute("value")??this.value,this.#o=this.#r?this.#r.value:null,this.#y(),this.openChanged()}disconnectedCallback(){this.#p.disconnect(),this.removeEventListener("request-select",this.handleRequestSelect),this.ownerDocument.removeEventListener("pointerdown",this.#u,!0),window.removeEventListener("resize",this.#c),window.removeEventListener("scroll",this.#c,!0),super.disconnectedCallback()}get options(){return wo(this)}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get visibleOptions(){T.track(this,"visibleOptions");let e=Je(this.value.trim());return e?this.options.filter(i=>Je(i.labelText).includes(e)):this.options}get activeOptionId(){return this.#n&&this.visibleOptions.includes(this.#n)?this.#n.optionId:""}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get displayErrorText(){T.track(this,"displayErrorText");let e=this.required&&this.#r===null&&!this.value.trim();return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:e?"Please choose an option.":""})}formStateRestoreCallback(e){typeof e=="string"&&(this.#h(null),this.options.forEach(i=>{i.selected=!1}),this.#a=e==="",this.value=e,this.handleSlotChange())}formResetCallback(){if(this.#h(null),this.#m(null),this.open=!1,this.options.forEach(e=>{e.selected=!1}),this.#o!==null){let e=ct(this.options,this.#o);this.#a=e===null&&this.#o==="",e?(this.#h(e),this.value=e.labelText):this.value=this.#t}else this.#i?(this.#a=!0,this.value=""):(this.#a=!1,this.value=this.#t);this.handleSlotChange()}handleSlotChange(){let e=this.options,i=this.open&&this.#r===null&&this.#s===null,o=this.#r&&e.includes(this.#r)&&!Me(this.#r)&&(this.#r.value===this.#s||!this.#r.hasAttribute("value"))?this.#r:null,r=o,n=o!==null||this.#s!==null;if(!r&&this.#s!==null&&!i&&(r=ct(e,this.#s)),!r&&!i){let l=this.value!==""?this.value:this.#a?"":null;r=ct(e,l),!r&&Je(this.value)!==""&&(r=e.find(d=>!Me(d)&&Je(d.labelText??d.textContent??"")===Je(this.value))??null)}r?(this.#a=!1,this.#h(r),(!this.open||n||!this.value||this.value===r.value||Je(this.value)===Je(r.labelText))&&(this.value=r.labelText)):(this.#r!==null||this.#s!==null||!this.open&&!this.value)&&this.#h(null);let s=this.visibleOptions,a=So(s,this.#n,this.activeValue,s[0]??null);a===this.#n?this.#b():this.#m(a),this.#y(),T.notify(this,"visibleOptions")}handleInputFocus(){!this.effectiveDisabled&&this.openOnFocus&&this.show()}handleControlClick(){return this.effectiveDisabled||(this.#k?.focus(),this.show()),!0}handleFocusOut(e){let i=e.relatedTarget;return this.open&&i&&!this.contains(i)&&!this.shadowRoot?.contains(i)&&this.hide(!0),!0}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.#a=!1,this.value=i?.value??"",this.open=!0;let o=this.#r?.labelText??"";(!this.#r||Je(o)!==Je(this.value))&&this.#h(null),this.#m(this.visibleOptions[0]??null),this.#y(),this.$emit("input",{value:this.value,selectedValue:this.selectedOptionValue})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#y(),this.$emit("change",{value:this.value,selectedValue:this.selectedOptionValue})}handleKeydown(e){switch(e.key){case"ArrowDown":return e.preventDefault(),e.altKey?this.show():(this.show(),this.#g(1)),!1;case"ArrowUp":return e.preventDefault(),e.altKey?this.open&&this.hide(!0):(this.show(),this.#g(-1)),!1;case"Enter":if(this.open&&this.#n&&this.visibleOptions.includes(this.#n)&&!Me(this.#n))return e.preventDefault(),this.#f(this.#n),!1;break;case"Tab":this.open&&this.hide(!0);break;case"Escape":if(this.open)return e.preventDefault(),this.hide(!0),!1;break}return!0}handleRequestSelect(e){e.stopPropagation();let i=zo(e,this.options);if(i){this.#f(i);return}let o=e.detail?.value??"";this.selectValue(o)}valueChanged(){if(this.value!==""&&(this.#a=!1),this.$fastController.isConnected){let e=this.visibleOptions;this.#n&&!e.includes(this.#n)?this.#m(e[0]??null):this.#b(),this.#y()}T.notify(this,"visibleOptions")}activeValueChanged(){this.#d||!this.$fastController.isConnected||(this.#n=this.visibleOptions.find(e=>e.value===this.activeValue&&!Me(e))??null,this.#b())}selectedOptionValueChanged(){this.#l||(this.#s=this.selectedOptionValue===""?null:this.selectedOptionValue,this.$fastController.isConnected&&(this.#r=this.#s===null?null:ct(this.options,this.#s),this.#b(),this.#y()))}requiredChanged(){this.#y()}disabledChanged(){this.#y()}invalidChanged(){this.#y()}errorTextChanged(){this.#y()}openChanged(){let e=this.#E,i=this.#$,o=this.#k;e?.classList.toggle("open",this.open),i?.toggleAttribute("hidden",!this.open),i?.isConnected&&i.matches(":popover-open")!==this.open&&(this.open?i.showPopover():i.hidePopover()),this.open&&this.#z(),o?.setAttribute("aria-expanded",String(this.open)),this.open&&requestAnimationFrame(()=>{this.#z()})}show(){if(this.effectiveDisabled)return;let e=this.open;this.open=!0;let i=this.visibleOptions,o=this.#n!==null&&i.includes(this.#n);if(!e||!o){let r=this.#r!==null&&i.includes(this.#r)?this.#r:null;this.#m(r??i[0]??null)}else this.#b()}hide(e){this.open=!1,e&&(this.value=this.#r?.labelText??""),this.#b(),this.#y(),T.notify(this,"visibleOptions")}selectValue(e){let i=ce(this.options).find(o=>o.value===e)??null;i&&this.#f(i)}#f(e){this.#a=!1,this.#h(e),this.value=e.labelText,this.#m(e),this.hide(!1),this.#b(),this.#y(),this.$emit("change",{value:this.value,selectedValue:e.value,label:e.labelText})}#h(e){this.#r=e,this.#s=e?e.value:null,this.#l=!0;try{this.selectedOptionValue=e?.value??""}finally{this.#l=!1}}#m(e){this.#n=e,this.#b(),this.#d=!0;try{this.activeValue=e?.value??""}finally{this.#d=!1}}#g(e){let i=this.visibleOptions,o=this.#n?i.indexOf(this.#n):-1,r=_o(i,o<0?e===1?-1:0:o,e);this.#m(r>=0?i[r]??null:null),this.#v()}#v(){this.#n?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({block:"nearest"})}#b(){let e=new Set(this.visibleOptions);for(let o of this.options)o.hidden=!e.has(o);let i=this.#n&&e.has(this.#n)?this.#n:null;Eo(this.options,this.#r?[this.#r]:[],i),this.#_()}#_(){let e=this.#k;e&&(e.ariaActiveDescendantElement=this.open&&this.#n&&this.visibleOptions.includes(this.#n)?this.#n:null)}#z(){let e=this.#$,i=this.#C;if(!e||!i)return;let o=i.getBoundingClientRect(),r=4,n=-1,s=o.left,a=o.bottom+n,l=Math.min(o.width,window.innerWidth-r*2);e.style.width=`${l}px`,e.style.left=`${Math.max(r,s)}px`,e.style.top=`${Math.max(r,a)}px`,requestAnimationFrame(()=>{let d=e.getBoundingClientRect();d.right>window.innerWidth-r&&(s=Math.max(r,window.innerWidth-d.width-r)),d.bottom>window.innerHeight-r&&(a=Math.max(r,o.top-d.height+1)),e.style.left=`${s}px`,e.style.top=`${a}px`})}get#E(){return this.shadowRoot?.querySelector(".control-shell")??null}get#$(){return this.shadowRoot?.querySelector(".panel")??null}get#C(){return this.shadowRoot?.querySelector(".control-frame")??null}get#k(){return this.shadowRoot?.querySelector('input[role="combobox"]')??null}get#S(){return this.effectiveDisabled?null:this.#r?this.#r.value:this.value||null}#y(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[role="combobox"]'),i=this.displayErrorText,o=i||(this.errorText??"").trim()||"Please choose an option.",r=this.#S,n=!this.effectiveDisabled&&this.invalid;if(this.validationMessageText!==i&&(this.validationMessageText=i,T.notify(this,"displayErrorText")),this.#e.ariaInvalid=n?"true":"false",this.#e.setFormValue(r,r),this.effectiveDisabled){this.#e.setValidity({});return}if(this.invalid){this.#e.setValidity({customError:!0},o,e??void 0);return}if(this.required&&this.#r===null&&!this.value.trim()){this.#e.setValidity({valueMissing:!0},o,e??void 0);return}this.#e.setValidity({})}};En([f],de.prototype,"open",void 0);En([f],de.prototype,"validationMessageText",void 0);En([f],de.prototype,"activeValue",void 0);En([f],de.prototype,"selectedOptionValue",void 0);c(de.prototype,"label");c(de.prototype,"placeholder");c({attribute:"supporting-text"})(de.prototype,"supportingText");c({attribute:"error-text"})(de.prototype,"errorText");c({mode:"fromView"})(de.prototype,"value");c(de.prototype,"name");c({mode:"boolean"})(de.prototype,"required");c({mode:"boolean"})(de.prototype,"disabled");G(de.prototype);c({mode:"boolean"})(de.prototype,"invalid");c({mode:"boolean"})(de.prototype,"open");c({attribute:"open-on-focus",mode:"boolean"})(de.prototype,"openOnFocus");var mp={name:"violet-combobox",template:jy,styles:Hy,shadowOptions:{delegatesFocus:!0}};var qy=b`
    ${De}
    ${A}

:host{
display:block;
flex:1 1 0;

--_segment-selected-background:var(
--violet-segment-selected-background,
var(--violet-color-surface-highlight,var(--_surface-card))
);
--_segment-selected-border:var(--violet-segment-selected-border,transparent);
--_segment-selected-shadow:var(--violet-segment-selected-shadow,var(--_shadow-control));
}

.button{
box-sizing:border-box;
display:flex;
align-items:center;
justify-content:center;
inline-size:100%;

min-block-size:calc(var(--_target-size) - 4px);
padding:0 var(--_space-md);
border:1px solid transparent;
border-radius:calc(var(--_radius-md) - 2px);
background:transparent;
color:var(--_text-secondary);
cursor:pointer;
font:inherit;
font-size:var(--_control-body-size);
font-weight:var(--_type-label-weight);

line-height:min(var(--_type-body-line),calc(var(--_target-size) - 6px));
text-align:center;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard);
}

.button:hover{
color:var(--violet-color-text-primary,#181b1a);
}

.button:focus-visible{
outline:none;
box-shadow:0 0 0 2px var(--_focus-ring);
}

:host([checked]) .button{
background:var(--_segment-selected-background);
border-color:var(--_segment-selected-border);
box-shadow:var(--_segment-selected-shadow);
color:var(--violet-color-text-primary,#181b1a);
}

:host([disabled]) .button,
:host([aria-disabled="true"]) .button{
cursor:not-allowed;
opacity:0.5;
}

@media (forced-colors:active){
.button,
.button:hover{
forced-color-adjust:none;
color:ButtonText;
}

:host([checked]) .button{
background:Highlight;
border-color:Highlight;
color:HighlightText;
box-shadow:none;
}
}
`,Wy=h`
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
`,Vi=class extends y{#e;#t;constructor(){super(),this.#e=!1,this.#t=null,this.checked=!1,this.disabled=!1,this.value=""}disabledChanged(){this.$emit("disabled-change")}get effectiveDisabled(){return T.track(this,"effectiveDisabled"),this.disabled||this.#e}get buttonTabIndex(){return T.track(this,"buttonTabIndex"),this.#t??0}setManagedTabIndex(e){this.#t=e,T.notify(this,"buttonTabIndex")}setCheckedFromGroup(e){this.checked=e}setGroupDisabled(e){this.#e=e,T.notify(this,"effectiveDisabled"),this.ariaDisabled=e?"true":null}focusButton(e){this.buttonElement?.focus(e)}handleClick(){this.effectiveDisabled||this.checked||this.$emit("select-request",{value:this.value})}get buttonElement(){return this.shadowRoot?.querySelector(".button")??null}};c({mode:"boolean"})(Vi.prototype,"checked");c({mode:"boolean"})(Vi.prototype,"disabled");c(Vi.prototype,"value");var vp={name:"violet-segment",template:Wy,styles:qy,shadowOptions:{delegatesFocus:!0}};var gp=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Ky=b`
    ${V}

:host{
display:grid;

--_well:color-mix(in srgb,var(--violet-color-text-primary,#181b1a) 7%,transparent);
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.group{
display:inline-flex;
align-items:stretch;
gap:2px;
padding:2px;
border-radius:var(--_radius-md);
background:var(--_well);
min-inline-size:0;
}

:host([disabled]) .group,
:host(:disabled) .group{
opacity:0.5;
}

:host([invalid]) .group{
box-shadow:inset 0 0 0 1px var(--_danger-border);
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-stack-2xs);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-stack-2xs);
}

@media (forced-colors:active){
.group{
forced-color-adjust:none;
border:1px solid ButtonText;
background:Canvas;
color:ButtonText;
box-shadow:none;
}
}
`,Uy=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
                <div class="label" part="label">${t=>t.label}</div>
            `)}
        <div class="group" part="group">
            <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
        </div>
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,Ie=class extends y{static{this.formAssociated=!0}#e;#t;#o;constructor(){super(),this.#e=this.attachInternals(),this.#e.role="radiogroup",this.#t="",this.#o=!1,this.segments=[],this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.disabled=!1,this.invalid=!1,this.required=!1}connectedCallback(){super.connectedCallback(),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.addEventListener("select-request",this.handleSelectRequest),this.addEventListener("disabled-change",this.handleSegmentDisabledChange),this.addEventListener("keydown",this.handleKeydown),this.handleSlotChange(),this.#t=this.value,this.#s(),this.#a(),M.enqueue(()=>this.#a())}disconnectedCallback(){this.removeEventListener("select-request",this.handleSelectRequest),this.removeEventListener("disabled-change",this.handleSegmentDisabledChange),this.removeEventListener("keydown",this.handleKeydown),super.disconnectedCallback()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#r()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}focus(e){this.#i()?.focusButton(e)}#i(){return this.segments.find(e=>this.contains(e)&&e.buttonTabIndex===0&&!e.effectiveDisabled)}handleSlotChange(){this.segments=this.#d(),this.#r()}valueChanged(){this.#o||this.#r()}labelChanged(){this.#n()}supportingTextChanged(){this.#n()}errorTextChanged(){this.#a()}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.#a()}disabledChanged(){this.#r()}invalidChanged(){this.#s(),this.#a()}requiredChanged(){this.#a()}handleSelectRequest(e){let i=e.target;!i||!this.segments.includes(i)||(this.value=e.detail?.value??i.value,this.#r(),this.$emit("change"))}handleSegmentDisabledChange(e){let i=e.target;i&&this.segments.includes(i)&&this.#r()}handleKeydown(e){let i=e.composedPath().find(a=>a instanceof HTMLElement&&a.tagName.toLowerCase()==="violet-segment");if(!i)return;let o=this.segments.filter(a=>!a.effectiveDisabled),r=o.indexOf(i);if(r<0)return;let n;switch(fe(e.key,this)){case"ArrowRight":case"ArrowDown":n=o[(r+1)%o.length];break;case"ArrowLeft":case"ArrowUp":n=o[(r-1+o.length)%o.length];break;case"Home":n=o[0];break;case"End":n=o.at(-1);break;default:return}if(e.preventDefault(),!n)return;let s=this.value;this.value=n.value,this.#r(),n.focusButton(),this.value!==s&&this.$emit("change")}#r(){this.#o=!0;let e=this.#d();this.segments=e;let i=n=>!!this.value&&n.value===this.value,o=this.effectiveDisabled?[]:e.filter(n=>!n.disabled),r=o.find(i)??o[0];for(let n of e)n.toggleAttribute("checked",i(n)),n.setGroupDisabled?.(this.effectiveDisabled),n.setManagedTabIndex?.(n===r?0:-1);this.#o=!1,this.#s(),this.#a()}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:this.required&&!this.value?"Please choose an option.":""})}#s(){let e=this.displayErrorText?"error-message":this.supportingText?"supporting-text":null,i=e?this.shadowRoot?.querySelector(`[part="${e}"]`):null;this.#e.ariaLabel=this.label||null,this.#e.ariaDisabled=this.effectiveDisabled?"true":null,this.#e.ariaRequired=this.required?"true":null,this.#e.ariaInvalid=!this.effectiveDisabled&&this.invalid?"true":null,this.#e.ariaDescribedByElements=i instanceof Element?[i]:null}#n(){M.enqueue(()=>M.enqueue(()=>this.#s()))}#a(){if(this.effectiveDisabled){this.validationMessageText="",this.#e.setValidity({}),this.#e.setFormValue(null),this.#n();return}if(this.validationMessageText=this.displayErrorText,this.invalid||this.required&&!this.value){let i=this.displayErrorText||(this.errorText??"").trim()||"Please choose an option.";this.#e.setValidity({customError:this.invalid,valueMissing:this.required&&!this.value},i,this.#i()?.shadowRoot?.querySelector("button")??void 0)}else this.#e.setValidity({});this.#e.setFormValue(this.value||null,this.value||null),this.#n()}#d(){return Array.from(this.querySelectorAll("violet-segment")).filter(e=>e.closest("violet-segmented-control")===this)}};gp([f],Ie.prototype,"segments",void 0);gp([f],Ie.prototype,"validationMessageText",void 0);c(Ie.prototype,"label");c({attribute:"supporting-text"})(Ie.prototype,"supportingText");c({attribute:"error-text"})(Ie.prototype,"errorText");c(Ie.prototype,"value");c(Ie.prototype,"name");c({mode:"boolean"})(Ie.prototype,"disabled");G(Ie.prototype);c({mode:"boolean"})(Ie.prototype,"invalid");c({mode:"boolean"})(Ie.prototype,"required");var bp={name:"violet-segmented-control",template:Uy,styles:Ky};var mi=0,Gy=b`
    ${V}

:host{
display:grid;


--_selection-fill:var(--violet-color-control-selected-foreground,#1b5f80);
--_rail-background:color-mix(in srgb,var(--violet-color-text-primary,#181b1a) 10%,transparent);
--_danger-border:var(--violet-color-state-danger-border,transparent);
--_radius-full:var(--violet-radius-round,9999px);
--_thumb-size:calc(var(--_target-size) * 0.5);
--_track-size:calc(var(--_target-size) * 0.125);
--_control-block-size:var(--_target-size);
--_vertical-track-size:calc(var(--_target-size) * 4);
--_tick-size:6px;
--_tick-color:var(--violet-color-border-strong,#6b7d6e);
--_start-percent:25%;
--_end-percent:75%;
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-shell{
position:relative;
display:grid;
align-items:center;
inline-size:100%;
min-inline-size:0;
block-size:var(--_control-block-size);
border-radius:var(--_radius-md);
}

:host([orientation="vertical"]) .control-shell{
justify-items:center;
inline-size:var(--_target-size);
block-size:var(--_vertical-track-size);
}

.input{
position:absolute;
inset:0;
margin:0;
inline-size:100%;
block-size:100%;
appearance:none;
-webkit-appearance:none;
background:transparent;
border:0;
opacity:0;
cursor:pointer;
touch-action:none;
pointer-events:none;
}

.input-start{
pointer-events:auto;
clip-path:inset(0 calc(100% - var(--_mid-percent)) 0 0);
}

.input-end{
pointer-events:auto;
clip-path:inset(0 0 0 var(--_mid-percent));
}

:host([orientation="vertical"]) .input{
writing-mode:vertical-lr;
direction:rtl;
}

:host([orientation="vertical"]) .input-start{
clip-path:inset(calc(100% - var(--_mid-percent)) 0 0 0);
}

:host([orientation="vertical"]) .input-end{
clip-path:inset(0 0 var(--_mid-percent) 0);
}

.visual{
position:relative;
display:grid;
align-items:center;
inline-size:100%;
block-size:100%;
pointer-events:none;
}

:host([orientation="vertical"]) .visual{
justify-items:center;
}

.rail{
position:relative;
inline-size:100%;
block-size:var(--_track-size);
border-radius:var(--_radius-full);
background:var(--_rail-background);
overflow:hidden;
}

:host([orientation="vertical"]) .rail{
inline-size:var(--_track-size);
block-size:100%;
}

.fill{
position:absolute;
inset-inline-start:var(--_start-percent);
inset-block-start:0;
inline-size:calc(var(--_end-percent) - var(--_start-percent));
block-size:100%;
border-radius:inherit;
background:var(--_selection-fill);
}

:host([orientation="vertical"]) .fill{
inset-inline-start:0;
inset-block-start:auto;
inset-block-end:var(--_start-percent);
inline-size:100%;
block-size:calc(var(--_end-percent) - var(--_start-percent));
}

.ticks{
display:none;
position:absolute;
inset-inline:0;
block-size:var(--_tick-size);
inset-block-start:calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
pointer-events:none;
}

:host([show-ticks]) .ticks{
display:block;
}

:host([orientation="vertical"]) .ticks{
inset-block:0;
inset-inline:auto;
inset-inline-start:calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
inline-size:var(--_tick-size);
block-size:auto;
}

.thumb{
position:absolute;
inset-block-start:50%;
inline-size:var(--_thumb-size);
block-size:var(--_thumb-size);
box-sizing:border-box;

border:1px solid transparent;
border-radius:var(--_radius-full);
background:var(--_selection-fill);
box-shadow:var(--_shadow-control);
transform:translate(-50%,-50%);
transition:
transform var(--_duration-base) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.thumb-start{
inset-inline-start:var(--_start-percent);
}

.thumb-end{
inset-inline-start:var(--_end-percent);
}

:host([orientation="vertical"]) .thumb{
inset-inline-start:50%;
inset-block-start:auto;
transform:translate(-50%,50%);
}

:host([orientation="vertical"]) .thumb-start{
inset-block-end:var(--_start-percent);
}

:host([orientation="vertical"]) .thumb-end{
inset-block-end:var(--_end-percent);
}

.control-shell:has(.input-start:focus-visible) .thumb-start{
box-shadow:
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}

.control-shell:has(.input-end:focus-visible) .thumb-end{
box-shadow:
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}

:host([disabled]) .input,
:host(:disabled) .input{
cursor:not-allowed;
}

:host([disabled]) .control-shell,
:host(:disabled) .control-shell{
cursor:not-allowed;
}

:host([disabled]) .visual,
:host(:disabled) .visual{
opacity:0.5;
}

:host([disabled]) .rail,
:host(:disabled) .rail{
background:color-mix(in srgb,var(--_rail-background) 55%,var(--_surface-page));
}

:host([disabled]) .fill,
:host(:disabled) .fill{
background:color-mix(in srgb,var(--_selection-fill) 55%,var(--_surface-page));
}

:host([disabled]) .thumb,
:host(:disabled) .thumb{
box-shadow:none;
}

:host([invalid]) .rail{
outline:1px solid var(--_danger-border);
outline-offset:-1px;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

@media (forced-colors:active){
.rail{
forced-color-adjust:none;
background:ButtonText;
}

.fill{
background:Highlight;
}

.thumb{
background:HighlightText;
border:1px solid Highlight;
box-shadow:none;
}

:host([disabled]) .rail,
:host(:disabled) .rail{
background:GrayText;
}

:host([disabled]) .fill,
:host(:disabled) .fill{
background:GrayText;
}

:host([disabled]) .thumb,
:host(:disabled) .thumb{
border-color:GrayText;
background:Canvas;
}
}
`,Yy=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
                aria-describedby="${t=>t.describedByIds||null}"
                aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
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
                aria-describedby="${t=>t.describedByIds||null}"
                aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
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
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" id="${t=>t.supportingTextId}" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" id="${t=>t.errorTextId}" part="error-message" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,ae=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;constructor(){super(),this.#e=this.attachInternals(),mi+=1,this.inputStartId=`violet-range-slider-${mi}-start`,this.inputEndId=`violet-range-slider-${mi}-end`,this.supportingTextId=`violet-range-slider-${mi}-supporting`,this.errorTextId=`violet-range-slider-${mi}-error`,this.labelId=`violet-range-slider-${mi}-label`,this.labelStartId=`violet-range-slider-${mi}-label-start`,this.labelEndId=`violet-range-slider-${mi}-label-end`,this.#t="",this.#o="",this.#i=null,this.#r=null,this.label="",this.supportingText="",this.errorText="",this.valueStart="25",this.valueEnd="75",this.min="0",this.max="100",this.step="1",this.name="",this.labelStart="Minimum",this.labelEnd="Maximum",this.required=!1,this.disabled=!1,this.invalid=!1,this.showTicks=!1,this.orientation="horizontal"}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}connectedCallback(){super.connectedCallback(),this.#t=this.getAttribute("value-start")??this.valueStart,this.#o=this.getAttribute("value-end")??this.valueEnd,this.#d(),this.#n(),this.#a()}formResetCallback(){this.valueStart=this.#t||this.min||"0",this.valueEnd=this.#o||this.max||"100",this.#n(),this.#a()}valueStartChanged(){this.$fastController.isConnected&&(this.#n(),this.#a())}valueEndChanged(){this.$fastController.isConnected&&(this.#n(),this.#a())}minChanged(){this.$fastController.isConnected&&(this.#n(),this.#a())}maxChanged(){this.$fastController.isConnected&&(this.#n(),this.#a())}stepChanged(){this.$fastController.isConnected&&this.#n()}disabledChanged(){this.$fastController.isConnected&&(this.#d(),this.#a())}errorTextChanged(){this.$fastController.isConnected&&this.#a()}invalidChanged(){this.$fastController.isConnected&&(this.#d(),this.#a())}orientationChanged(){this.$fastController.isConnected&&this.#d()}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText})}get validationMessageText(){return this.displayErrorText}thumbLabelledBy(e){let i=e==="start"?this.labelStartId:this.labelEndId;return this.label?`${this.labelId} ${i}`:i}get describedByIds(){return this.displayErrorText?this.errorTextId:this.supportingText?this.supportingTextId:""}get value(){return this.valueStart}get controlStyle(){return`--_start-percent: ${this.startPercent}; --_end-percent: ${this.endPercent}; --_mid-percent: ${this.midPercent};`}get tickStyle(){let e=this.minAsNumber,i=this.maxAsNumber,o=this.stepAsNumber,r=i-e;if(r<=0||o<=0)return"";let n=Math.round(r/o);if(n<2||n>50)return"";let s=[];for(let l=0;l<=n;l++){let d=l/n*100;l===0?s.push("var(--_tick-color) 0","var(--_tick-color) 1px","transparent 1px"):l===n?s.push("transparent calc(100% - 1px)","var(--_tick-color) calc(100% - 1px)","var(--_tick-color) 100%"):s.push(`transparent calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% + 0.5px)`,`transparent calc(${d}% + 0.5px)`)}return`background-image: linear-gradient(${this.orientation==="vertical"?"to top":"to right"}, ${s.join(", ")});`}handleInput(e){e.stopPropagation(),this.#s(e,"input")}handleCommit(e){this.#s(e,"change")}#s(e,i){let o=e.currentTarget;if(!o)return;let r=o.value,n=Number.parseFloat(r);if(o.classList.contains("input-start")){let a=this.valueEndAsNumber;n>a?(this.valueStart=String(a),o.value=String(a)):this.valueStart=r}else{let a=this.valueStartAsNumber;n<a?(this.valueEnd=String(a),o.value=String(a)):this.valueEnd=r}this.$emit(i,{valueStart:this.valueStart,valueEnd:this.valueEnd})}handlePointerDown(e,i){if(this.effectiveDisabled||!this.#p(e))return;e.preventDefault(),this.#i=i,this.#r=e.pointerId,(i==="start"?this.#f:this.#h)?.focus({preventScroll:!0}),this.#_(),this.ownerDocument.addEventListener("pointermove",this.#v),this.ownerDocument.addEventListener("pointerup",this.#b),this.ownerDocument.addEventListener("pointercancel",this.#b),this.#m(e,"input")}disconnectedCallback(){this.#_(),super.disconnectedCallback()}#n(){this.valueStart=this.#c(this.valueStart),this.valueEnd=this.#c(this.valueEnd);let e=Number.parseFloat(this.valueStart),i=Number.parseFloat(this.valueEnd);Number.isFinite(e)&&Number.isFinite(i)&&e>i&&(this.valueStart=this.valueEnd);let o=this.#f;o&&o.value!==this.valueStart&&(o.value=this.valueStart);let r=this.#h;r&&r.value!==this.valueEnd&&(r.value=this.valueEnd)}#a(){if(this.effectiveDisabled){this.#e.setFormValue(null),this.#e.setValidity({});return}let e=new FormData,i=this.name||"range";if(e.append(`${i}-start`,this.valueStart),e.append(`${i}-end`,this.valueEnd),this.#e.setFormValue(e),this.invalid){this.#e.setValidity({customError:!0},this.displayErrorText||"Please choose a valid range.");return}this.#e.setValidity({})}#d(){this.#l("disabled",this.disabled),this.#l("invalid",this.invalid);let e=this.orientation==="vertical"?"vertical":"horizontal";this.getAttribute("orientation")!==e&&this.setAttribute("orientation",e)}#l(e,i){this.hasAttribute(e)!==i&&this.toggleAttribute(e,i)}#c(e){let i=this.minAsNumber,o=this.maxAsNumber,r=this.stepAsNumber,n=Number.parseFloat(e),s=Number.isFinite(n)?n:i,a=Math.min(o,Math.max(i,s));if(!Number.isFinite(r)||r<=0)return String(a);let l=Math.round((a-i)/r)*r+i,d=this.#u(r);return String(Number(l.toFixed(d)))}#u(e){let[,i=""]=String(e).split(".");return i.length}#p(e){return e.pointerType!=="mouse"||e.button===0}get#f(){return this.shadowRoot?.querySelector(".input-start")??null}get#h(){return this.shadowRoot?.querySelector(".input-end")??null}#m(e,i){let o=this.#i;if(!o)return;let r=o==="start"?this.#f:this.#h;if(!r)return;let n=this.#g(e,r);if(n!==null){if(o==="start"){let s=this.valueEndAsNumber,l=Number.parseFloat(n)>s?String(s):n;this.valueStart!==l&&(this.valueStart=l),r.value!==this.valueStart&&(r.value=this.valueStart)}else{let s=this.valueStartAsNumber,l=Number.parseFloat(n)<s?String(s):n;this.valueEnd!==l&&(this.valueEnd=l),r.value!==this.valueEnd&&(r.value=this.valueEnd)}i==="input"?this.$emit("input",{valueStart:this.valueStart,valueEnd:this.valueEnd}):this.$emit("change",{valueStart:this.valueStart,valueEnd:this.valueEnd})}}#g(e,i){let o=i.getBoundingClientRect(),r=this.minAsNumber,n=this.maxAsNumber;if(o.width<=0||o.height<=0||n<=r)return null;let s=this.orientation==="vertical"?1-(e.clientY-o.top)/o.height:(e.clientX-o.left)/o.width,a=Math.min(1,Math.max(0,s)),l=r+a*(n-r);return this.#c(String(l))}#v=e=>{e.pointerId===this.#r&&(e.preventDefault(),this.#m(e,"input"))};#b=e=>{e.pointerId===this.#r&&(e.preventDefault(),this.#m(e,"change"),this.#i=null,this.#r=null,this.#_())};#_(){this.ownerDocument.removeEventListener("pointermove",this.#v),this.ownerDocument.removeEventListener("pointerup",this.#b),this.ownerDocument.removeEventListener("pointercancel",this.#b)}get minAsNumber(){let e=Number.parseFloat(this.min);return Number.isFinite(e)?e:0}get maxAsNumber(){let e=Number.parseFloat(this.max);return Number.isFinite(e)?e:100}get stepAsNumber(){let e=Number.parseFloat(this.step);return Number.isFinite(e)?e:1}get valueStartAsNumber(){let e=Number.parseFloat(this.valueStart);return Number.isFinite(e)?e:this.minAsNumber}get valueEndAsNumber(){let e=Number.parseFloat(this.valueEnd);return Number.isFinite(e)?e:this.maxAsNumber}get startPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"0%";let o=(this.valueStartAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,o))*100}%`}get endPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"100%";let o=(this.valueEndAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,o))*100}%`}get midPercent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"50%";let o=(this.valueStartAsNumber-e)/(i-e),r=(this.valueEndAsNumber-e)/(i-e),n=(o+r)/2;return`${Math.min(1,Math.max(0,n))*100}%`}};c(ae.prototype,"label");c({attribute:"supporting-text"})(ae.prototype,"supportingText");c({attribute:"error-text"})(ae.prototype,"errorText");c({attribute:"value-start"})(ae.prototype,"valueStart");c({attribute:"value-end"})(ae.prototype,"valueEnd");c(ae.prototype,"min");c(ae.prototype,"max");c(ae.prototype,"step");c(ae.prototype,"name");c({attribute:"label-start"})(ae.prototype,"labelStart");c({attribute:"label-end"})(ae.prototype,"labelEnd");c({mode:"boolean"})(ae.prototype,"required");c({mode:"boolean"})(ae.prototype,"disabled");G(ae.prototype);c({mode:"boolean"})(ae.prototype,"invalid");c({attribute:"show-ticks",mode:"boolean"})(ae.prototype,"showTicks");c(ae.prototype,"orientation");var yp={name:"violet-range-slider",template:Yy,styles:Gy,shadowOptions:{delegatesFocus:!0}};var xp=0,Xy=b`
    ${V}

:host{
display:grid;


--_selection-fill:var(--violet-color-control-selected-foreground,#1b5f80);
--_rail-background:color-mix(in srgb,var(--violet-color-text-primary,#181b1a) 10%,transparent);
--_danger-border:var(--violet-color-state-danger-border,transparent);
--_radius-full:var(--violet-radius-round,9999px);
--_thumb-size:calc(var(--_target-size) * 0.5);
--_track-size:calc(var(--_target-size) * 0.125);
--_control-block-size:var(--_target-size);
--_vertical-track-size:calc(var(--_target-size) * 4);
--_tick-size:6px;
--_tick-color:var(--violet-color-border-strong,#6b7d6e);
--_slider-percent:50%;
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-shell{
position:relative;
display:grid;
align-items:center;
inline-size:100%;
min-inline-size:0;
block-size:var(--_control-block-size);
border-radius:var(--_radius-md);
}

:host([orientation="vertical"]) .control-shell{
justify-items:center;
inline-size:var(--_target-size);
block-size:var(--_vertical-track-size);
}

.input{
position:absolute;
inset:0;
margin:0;
inline-size:100%;
block-size:100%;
appearance:none;
-webkit-appearance:none;
background:transparent;
border:0;
opacity:0;
cursor:pointer;
touch-action:none;
}

:host([orientation="vertical"]) .input{
writing-mode:vertical-lr;
direction:rtl;
}

.visual{
position:relative;
display:grid;
align-items:center;
inline-size:100%;
block-size:100%;
pointer-events:none;
}

:host([orientation="vertical"]) .visual{
justify-items:center;
}

.rail{
position:relative;
inline-size:100%;
block-size:var(--_track-size);
border-radius:var(--_radius-full);
background:var(--_rail-background);
overflow:hidden;
}

:host([orientation="vertical"]) .rail{
inline-size:var(--_track-size);
block-size:100%;
}

.fill{
position:absolute;
inset-inline-start:0;
inset-block-start:0;
inline-size:var(--_slider-percent);
block-size:100%;
border-radius:inherit;
background:var(--_selection-fill);
}

:host([orientation="vertical"]) .fill{
inset-block-start:auto;
inset-block-end:0;
inline-size:100%;
block-size:var(--_slider-percent);
}

.ticks{
display:none;
position:absolute;
inset-inline:0;
block-size:var(--_tick-size);
inset-block-start:calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
pointer-events:none;
}

:host([show-ticks]) .ticks{
display:block;
}

:host([orientation="vertical"]) .ticks{
inset-block:0;
inset-inline:auto;
inset-inline-start:calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
inline-size:var(--_tick-size);
block-size:auto;
}

.thumb{
position:absolute;
inset-inline-start:var(--_slider-percent);
inset-block-start:50%;
inline-size:var(--_thumb-size);
block-size:var(--_thumb-size);
box-sizing:border-box;

border:1px solid transparent;
border-radius:var(--_radius-full);
background:var(--_selection-fill);
box-shadow:var(--_shadow-control);
transform:translate(-50%,-50%);
transition:
transform var(--_duration-base) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

:host([orientation="vertical"]) .thumb{
inset-inline-start:50%;
inset-block-start:auto;
inset-block-end:var(--_slider-percent);
transform:translate(-50%,50%);
}

.control-shell:focus-within .thumb{
box-shadow:
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}

:host([disabled]) .input,
:host(:disabled) .input{
cursor:not-allowed;
}

:host([disabled]) .control-shell,
:host(:disabled) .control-shell{
cursor:not-allowed;
}

:host([disabled]) .visual,
:host(:disabled) .visual{
opacity:0.5;
}

:host([disabled]) .rail,
:host(:disabled) .rail{
background:color-mix(in srgb,var(--_rail-background) 55%,var(--_surface-page));
}

:host([disabled]) .fill,
:host(:disabled) .fill{
background:color-mix(in srgb,var(--_selection-fill) 55%,var(--_surface-page));
}

:host([disabled]) .thumb,
:host(:disabled) .thumb{
box-shadow:none;
}

:host([invalid]) .rail{
outline:1px solid var(--_danger-border);
outline-offset:-1px;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

@media (forced-colors:active){
.rail{
forced-color-adjust:none;
background:ButtonText;
}

.fill{
background:Highlight;
}

.thumb{
background:HighlightText;
border:1px solid Highlight;
box-shadow:none;
}

:host([disabled]) .rail,
:host(:disabled) .rail{
background:GrayText;
}

:host([disabled]) .fill,
:host(:disabled) .fill{
background:GrayText;
}

:host([disabled]) .thumb,
:host(:disabled) .thumb{
border-color:GrayText;
background:Canvas;
}
}
`,Qy=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
                aria-describedby="${t=>t.describedByIds||null}"
                aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
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
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" id="${t=>t.supportingTextId}" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" id="${t=>t.errorTextId}" part="error-message" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,ue=class extends y{static{this.formAssociated=!0}#e;#t;#o;constructor(){super(),this.#e=this.attachInternals(),xp+=1,this.inputId=`violet-slider-${xp}`,this.supportingTextId=`${this.inputId}-supporting`,this.errorTextId=`${this.inputId}-error`,this.#t="",this.#o=null,this.label="",this.supportingText="",this.errorText="",this.valueText="",this.value="50",this.min="0",this.max="100",this.step="1",this.name="",this.required=!1,this.orientation="horizontal",this.disabled=!1,this.invalid=!1,this.showFill=!1,this.showTicks=!1}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}connectedCallback(){super.connectedCallback(),this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name),this.#t=this.getAttribute("value")??this.value,this.#s(),this.#i(),this.#r()}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t||this.min||"0",this.#i(),this.#r()}nameChanged(){this.$fastController.isConnected&&this.name&&this.getAttribute("name")!==this.name&&this.setAttribute("name",this.name)}valueChanged(){this.$fastController.isConnected&&(this.#i(),this.#r())}errorTextChanged(){this.$fastController.isConnected&&this.#r()}minChanged(){this.$fastController.isConnected&&(this.#i(),this.#r())}maxChanged(){this.$fastController.isConnected&&(this.#i(),this.#r())}stepChanged(){this.$fastController.isConnected&&this.#i()}disabledChanged(){this.$fastController.isConnected&&(this.#s(),this.#r())}invalidChanged(){this.$fastController.isConnected&&(this.#s(),this.#r())}orientationChanged(){this.$fastController.isConnected&&this.#s()}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText})}get validationMessageText(){return this.displayErrorText}get describedByIds(){return this.displayErrorText?this.errorTextId:this.supportingText?this.supportingTextId:""}get controlStyle(){return`--_slider-percent: ${this.percent};`}get tickStyle(){let e=this.minAsNumber,i=this.maxAsNumber,o=this.stepAsNumber,r=i-e;if(r<=0||o<=0)return"";let n=Math.round(r/o);if(n<2||n>50)return"";let s=[];for(let l=0;l<=n;l++){let d=l/n*100;l===0?s.push("var(--_tick-color) 0","var(--_tick-color) 1px","transparent 1px"):l===n?s.push("transparent calc(100% - 1px)","var(--_tick-color) calc(100% - 1px)","var(--_tick-color) 100%"):s.push(`transparent calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% - 0.5px)`,`var(--_tick-color) calc(${d}% + 0.5px)`,`transparent calc(${d}% + 0.5px)`)}return`background-image: linear-gradient(${this.orientation==="vertical"?"to top":"to right"}, ${s.join(", ")});`}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.value=i?.value??this.value,this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??this.value,this.$emit("change",{value:this.value})}handlePointerDown(e){if(this.effectiveDisabled||!this.#l(e))return;let i=this.#c;i&&(e.preventDefault(),this.#o=e.pointerId,i.focus({preventScroll:!0}),this.#m(),this.ownerDocument.addEventListener("pointermove",this.#f),this.ownerDocument.addEventListener("pointerup",this.#h),this.ownerDocument.addEventListener("pointercancel",this.#h),this.#u(e,"input"))}disconnectedCallback(){this.#m(),super.disconnectedCallback()}#i(){this.value=this.#a(this.value);let e=this.#c;e&&e.value!==this.value&&(e.value=this.value)}#r(){if(this.effectiveDisabled){this.#e.setFormValue(null),this.#e.setValidity({});return}if(this.#e.setFormValue(this.value),this.invalid){this.#e.setValidity({customError:!0},this.displayErrorText||"Please choose a valid value.");return}this.#e.setValidity({})}#s(){this.#n("disabled",this.disabled),this.#n("invalid",this.invalid);let e=this.orientation==="vertical"?"vertical":"horizontal";this.getAttribute("orientation")!==e&&this.setAttribute("orientation",e)}#n(e,i){this.hasAttribute(e)!==i&&this.toggleAttribute(e,i)}#a(e){let i=this.minAsNumber,o=this.maxAsNumber,r=this.stepAsNumber,n=Number.parseFloat(e),s=Number.isFinite(n)?n:i,a=Math.min(o,Math.max(i,s));if(!Number.isFinite(r)||r<=0)return String(a);let l=Math.round((a-i)/r)*r+i,d=this.#d(r);return String(Number(l.toFixed(d)))}#d(e){let[,i=""]=String(e).split(".");return i.length}#l(e){return e.pointerType!=="mouse"||e.button===0}get#c(){return this.shadowRoot?.querySelector(".input")??null}#u(e,i){let o=this.#c;if(!o)return;let r=this.#p(e,o);r!==null&&(this.value!==r&&(this.value=r),o.value!==this.value&&(o.value=this.value),i==="input"?this.$emit("input",{value:this.value}):this.$emit("change",{value:this.value}))}#p(e,i){let o=i.getBoundingClientRect(),r=this.minAsNumber,n=this.maxAsNumber;if(o.width<=0||o.height<=0||n<=r)return null;let s=this.orientation==="vertical"?1-(e.clientY-o.top)/o.height:(e.clientX-o.left)/o.width,a=Math.min(1,Math.max(0,s)),l=r+a*(n-r);return this.#a(String(l))}#f=e=>{e.pointerId===this.#o&&(e.preventDefault(),this.#u(e,"input"))};#h=e=>{e.pointerId===this.#o&&(e.preventDefault(),this.#u(e,"change"),this.#o=null,this.#m())};#m(){this.ownerDocument.removeEventListener("pointermove",this.#f),this.ownerDocument.removeEventListener("pointerup",this.#h),this.ownerDocument.removeEventListener("pointercancel",this.#h)}get minAsNumber(){let e=Number.parseFloat(this.min);return Number.isFinite(e)?e:0}get maxAsNumber(){let e=Number.parseFloat(this.max);return Number.isFinite(e)?e:100}get stepAsNumber(){let e=Number.parseFloat(this.step);return Number.isFinite(e)?e:1}get valueAsNumber(){let e=Number.parseFloat(this.value);return Number.isFinite(e)?e:this.minAsNumber}get percent(){let e=this.minAsNumber,i=this.maxAsNumber;if(i<=e)return"0%";let o=(this.valueAsNumber-e)/(i-e);return`${Math.min(1,Math.max(0,o))*100}%`}};c(ue.prototype,"label");c({attribute:"supporting-text"})(ue.prototype,"supportingText");c({attribute:"error-text"})(ue.prototype,"errorText");c({attribute:"value-text"})(ue.prototype,"valueText");c(ue.prototype,"value");c(ue.prototype,"min");c(ue.prototype,"max");c(ue.prototype,"step");c(ue.prototype,"name");c({mode:"boolean"})(ue.prototype,"required");c(ue.prototype,"orientation");c({mode:"boolean"})(ue.prototype,"disabled");G(ue.prototype);c({mode:"boolean"})(ue.prototype,"invalid");c({attribute:"show-fill",mode:"boolean"})(ue.prototype,"showFill");c({attribute:"show-ticks",mode:"boolean"})(ue.prototype,"showTicks");var wp={name:"violet-slider",template:Qy,styles:Xy,shadowOptions:{delegatesFocus:!0}};var Jy=b`
    ${A}

:host{
display:block;
--_skeleton-surface:color-mix(in srgb,var(--_text-primary) 8%,transparent);
--_skeleton-highlight:color-mix(in srgb,var(--violet-color-surface-highlight,#ffffff) 68%,var(--_surface-card));
--_skeleton-radius:var(--_radius-sm);
--_skeleton-block-size:0.875rem;
--_skeleton-circle-size:2rem;
}

:host([size="sm"]){
--_skeleton-block-size:0.75rem;
--_skeleton-circle-size:1.5rem;
}

:host([size="md"]){
--_skeleton-block-size:0.875rem;
--_skeleton-circle-size:2rem;
}

:host([size="lg"]){
--_skeleton-block-size:1rem;
--_skeleton-circle-size:2.75rem;
}

.root{
display:grid;
gap:var(--_space-stack-2xs);
}

.bar{
position:relative;
overflow:hidden;
inline-size:100%;
block-size:var(--_skeleton-block-size);
border-radius:var(--_skeleton-radius);
background:var(--_skeleton-surface);
}

.bar.circle{
inline-size:var(--_skeleton-circle-size);
block-size:var(--_skeleton-circle-size);
border-radius:var(--_radius-round);
}

.bar::after{
content: "";
position:absolute;
inset:0;
transform:translateX(-100%);
background:linear-gradient(
90deg,
transparent 0%,
color-mix(in srgb,var(--_skeleton-highlight) 30%,transparent) 40%,
color-mix(in srgb,var(--_skeleton-highlight) 75%,transparent) 50%,
color-mix(in srgb,var(--_skeleton-highlight) 30%,transparent) 60%,
transparent 100%
);
animation:shimmer 1.6s linear infinite;
}

:host(:not([animated])) .bar::after{
display:none;
}

@keyframes shimmer{
to{
transform:translateX(100%);
}
}


@media (prefers-reduced-motion:reduce){
.bar::after{
display:none;
animation:none;
}
}

@media (forced-colors:active){
.bar{
forced-color-adjust:none;
background:GrayText;
}

.bar::after{
display:none;
}
}
`,Zy=t=>{let e=Math.max(1,Number(t.lines)||1);return Array.from({length:e},(i,o)=>e===1?"100%":o===e-1?"68%":o%3===1?"84%":"100%")},ex=h`
    <div class="root" part="root" aria-hidden="true">
        ${N(t=>Zy(t),h`
                <div
                    class="${(t,e)=>`bar${e.parent.shape==="circle"?" circle":""}`}"
                    part="bar"
                    style="inline-size:${t=>t};"
                ></div>
            `)}
    </div>
`,vi=class extends y{constructor(){super(),this.shape="rect",this.size="md",this.lines="1",this.animated=!1}connectedCallback(){super.connectedCallback(),this.setAttribute("aria-hidden","true")}};c(vi.prototype,"shape");c(vi.prototype,"size");c(vi.prototype,"lines");c({mode:"boolean"})(vi.prototype,"animated");var _p={name:"violet-skeleton",template:ex,styles:Jy};var tx=b`
    ${A}


:host{
display:inline-flex;
--_spinner-size:24px;
}

:host([size="sm"]){
--_spinner-size:16px;
}

:host([size="lg"]){
--_spinner-size:32px;
}

.spinner{
display:inline-flex;
inline-size:var(--_spinner-size);
block-size:var(--_spinner-size);
color:var(--_text-secondary);
}


.mark{
display:block;
inline-size:100%;
block-size:100%;
fill:none;
stroke:currentColor;
stroke-width:2.5;
}

.rest{
opacity:0.2;
}

.run{
stroke-dasharray:28 72;
animation:trace 1s linear infinite;
}

@keyframes trace{
from{
stroke-dashoffset:0;
}

to{
stroke-dashoffset:-100;
}
}

@media (prefers-reduced-motion:reduce){
.run{
animation-duration:3s;
}
}

@media (forced-colors:active){
.spinner{
forced-color-adjust:none;
color:Highlight;
}

.rest{
stroke:GrayText;
opacity:1;
}
}
`,ix=h`
    <span
        class="spinner"
        part="spinner"
        role="${t=>t.decorative?"presentation":"img"}"
        aria-hidden="${t=>t.decorative?"true":"false"}"
        aria-label="${t=>t.decorative?null:t.accessibleLabel}"
    >
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect class="rest" x="3" y="3" width="18" height="18" rx="3"></rect>
            <rect class="run" x="3" y="3" width="18" height="18" rx="3" pathLength="100"></rect>
        </svg>
    </span>
`,Oi=class extends y{constructor(){super(),this.label="",this.decorative=!1,this.size="md"}get accessibleLabel(){return T.trackVolatile(),this.label||"Loading"}};c(Oi.prototype,"label");c({mode:"boolean"})(Oi.prototype,"decorative");c(Oi.prototype,"size");var kp={name:"violet-spinner",template:ix,styles:tx};var oa=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Cp=0,ox=b`
    ${V}

:host{
display:inline-grid;

--_selection-background:var(--violet-color-control-selected-background,#c0daeb);
--_selection-text:var(--violet-color-control-selected-foreground,#1b5f80);
--_selection-border:var(--violet-color-control-selected-border,rgba(27,95,128,0.5));
--_surface-card:var(--violet-color-surface-card,#f8f9f3);
--_border-strong:var(--violet-color-border-strong,#6b7d6e);
--_radius-sm:var(--violet-radius-inset,4px);
--_size-font-md:var(--violet-type-body-size,14px);





--_track-block-size:var(--_type-body-line);
--_track-inline-size:calc(var(--_track-block-size) * 1.8);
--_track-border-width:0px;
--_track-padding:2px;
--_track-edge:0 0 0 0 transparent;
--_thumb-size:calc(var(--_track-block-size) - (var(--_track-padding) * 2));
--_thumb-offset:calc(
var(--_track-inline-size) -
var(--_thumb-size) -
(var(--_track-padding) * 2) -
(var(--_track-border-width) * 2)
);
--_type-body-line:var(--violet-type-body-line,20px);
--_type-caption-line:var(--violet-type-caption-line,16px);
}

:host([inline]){
--_target-size:var(--violet-switch-inline-target-size,var(--_target-size-compact));
--_space-inline-sm:var(--violet-switch-inline-gap,4px);
}

.root{
display:inline-grid;
grid-template-columns:auto minmax(0,1fr);
gap:var(--_space-inline-md);
align-items:start;
min-block-size:var(--_target-size);
cursor:pointer;
}

:host([inline]) .root{
grid-template-columns:auto;
gap:0;
align-items:center;
min-block-size:auto;
}

.control-shell{
position:relative;
display:inline-grid;
min-block-size:var(--_target-size);
align-items:center;
}

:host([inline]) .control-shell{
min-block-size:auto;
line-height:0;
}







.input{
position:absolute;
inset:0;
inline-size:100%;
block-size:100%;
margin:0;
padding:0;
appearance:none;
opacity:0;
border:0;
cursor:inherit;
}

.track{
box-sizing:border-box;
position:relative;
display:inline-block;
pointer-events:none;
inline-size:var(--_track-inline-size);
block-size:var(--_track-block-size);
border:var(--_track-border-width) solid var(--_border-strong);
border-radius:calc(var(--_radius-sm) + var(--_track-padding));
background:var(--_border-strong);
box-shadow:var(--_track-edge);
transition:
background-color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.thumb{
position:absolute;
inset-inline-start:var(--_track-padding);
inset-block-start:50%;
inline-size:var(--_thumb-size);
block-size:var(--_thumb-size);
border-radius:var(--_radius-sm);
background:var(--_surface-card);
box-shadow:var(--_shadow-control);
transform:translate(0,-50%);
transform-origin:center;
transition:
transform var(--_duration-base) var(--_easing-standard),
background-color var(--_duration-fast) var(--_easing-standard);
}


.thumb::after{
content: "";
position:absolute;
inset:0;
margin:auto;
inline-size:62%;
block-size:62%;
background:var(--_selection-background);
clip-path:polygon(14% 44%,0 59%,37% 100%,100% 16%,84% 0,35% 62%);
opacity:0;
transform:scale(0.6);
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

.root:hover .input:not(:checked):not(:disabled) + .track{
background:var(--_field-border-hover);
}

.input:checked + .track{
background:var(--_selection-background);
--_track-edge:inset 0 0 0 1px var(--_selection-border);
}

.input:checked + .track .thumb{
transform:translate(var(--_thumb-offset),-50%);
background:var(--_selection-text);
box-shadow:none;
}

.input:checked + .track .thumb::after{
opacity:1;
transform:scale(1);
}


:host([invalid]) .track{
--_track-edge:inset 0 0 0 1px var(--_danger-border);
}

.input:focus-visible + .track{
box-shadow:
var(--_track-edge),
0 0 0 2px var(--_surface-page),
0 0 0 4px var(--_focus-ring);
}

:host([disabled]) .root,
:host(:disabled) .root{
cursor:not-allowed;
}


:host([disabled]) :is(.control-shell,.label),
:host(:disabled) :is(.control-shell,.label){
opacity:0.5;
}





.content{
box-sizing:border-box;
display:grid;
gap:var(--_space-stack-2xs);
min-block-size:var(--_target-size);
padding-block:calc((var(--_target-size) - var(--_type-body-line)) / 2);
align-content:start;
min-inline-size:0;
}

.content[hidden]{
display:none;
}

:host([inline]) .content{
min-block-size:auto;
padding-block:0;
align-content:center;
}

.label{
color:var(--violet-color-text-primary,#181b1a);
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
}

.supporting{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting[hidden]{
display:none;
}

.error{
color:var(--_danger-text);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

@media (forced-colors:active){

:host{
--_track-border-width:1px;
}

.track,
.root:hover .input:not(:checked):not(:disabled) + .track{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
}

.thumb{
background:ButtonText;
box-shadow:none;
}

.thumb::after{
background:Highlight;
}

.input:checked + .track{
border-color:Highlight;
background:Highlight;
}

.input:checked + .track .thumb{
background:HighlightText;
}


.input:focus-visible + .track{
box-shadow:
0 0 0 2px Canvas,
0 0 0 4px Highlight;
}

:host([disabled]) .track,
:host(:disabled) .track{
border-color:GrayText;
background:Canvas;
}

:host([disabled]) .thumb,
:host(:disabled) .thumb{
background:GrayText;
}
}
`,rx=h`
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
        <span class="content" ?hidden="${t=>t.inline&&!t.hasLabel&&!t.hasSupporting&&!t.displayErrorText}">
            <label class="label" part="label" for="${t=>t.controlId}" ?hidden="${t=>t.inline&&!t.hasLabel}">
                <slot @slotchange="${t=>t.handleDefaultSlotChange()}"></slot>
            </label>
            <span
                class="supporting"
                id="${t=>t.supportingTextId}"
                part="supporting-text"
                ?hidden="${t=>!t.hasSupporting||!!t.displayErrorText}"
            >
                <slot name="supporting" @slotchange="${t=>t.handleSupportingSlotChange()}"></slot>
            </span>
            ${g(t=>!!t.displayErrorText,h`
                    <span
                        class="error"
                        id="${t=>t.errorTextId}"
                        part="error-message"
                        role="alert"
                    >${t=>t.displayErrorText}</span>
                `)}
        </span>
    </div>
`,Ee=class extends y{static{this.formAssociated=!0}#e;#t;get displayErrorText(){return this._displayErrorText}constructor(){super(),this._displayErrorText="",this.#e=this.attachInternals();let e=Cp;Cp+=1,this.controlId=`${this.localName||"violet-switch"}-control-${e}`,this.supportingTextId=`${this.localName||"violet-switch"}-supporting-${e}`,this.errorTextId=`${this.localName||"violet-switch"}-error-${e}`,this.hasSupporting=!1,this.hasLabel=!1,this.checked=!1,this.disabled=!1,this.inline=!1,this.invalid=!1,this.errorText="",this.name="",this.value="on",this.required=!1,this.#t=!1}connectedCallback(){super.connectedCallback(),this.#t=this.hasAttribute("checked")?this.getAttribute("checked")!=="false":this.checked,this.#i(),this.#r(),this.#n(),this.#a()}handleChange(e){let i=e.currentTarget;this.checked=i?.checked??!1,this.$emit("change",{checked:this.checked})}handleTrackClick(){this.shadowRoot?.querySelector('input[type="checkbox"]')?.click()}handleDefaultSlotChange(){this.#i(),this.#n()}handleSupportingSlotChange(){this.#r(),this.#n()}formStateRestoreCallback(e){(e==="checked"||e==="unchecked")&&(this.checked=e==="checked")}formResetCallback(){this.checked=this.#t}get explicitAriaLabel(){return this.getAttribute("aria-label")?.trim()||null}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}checkedChanged(){this.#n(),this.#a()}disabledChanged(){this.#n(),this.#a()}invalidChanged(){this.#n(),this.#a()}errorTextChanged(){this.#a()}#o(e){this._displayErrorText!==e&&(this._displayErrorText=e,this.$fastController.isConnected&&M.enqueue(()=>{M.enqueue(()=>{this.#n()})}))}requiredChanged(){this.#n(),this.#a()}valueChanged(){this.#n(),this.#a()}nameChanged(){this.#n()}#i(){this.hasLabel=this.#s().length>0}#r(){let e=this.shadowRoot?.querySelector('slot[name="supporting"]');this.hasSupporting=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#s(){return Array.from(this.childNodes).filter(e=>e.nodeType!==Node.ELEMENT_NODE?!0:!e.hasAttribute("slot")).map(e=>e.textContent??"").join(" ").trim()}#n(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(!e)return;e.checked=this.checked,e.disabled=this.effectiveDisabled,e.required=this.required,e.name=this.name,e.value=this.value,e.setAttribute("role","switch"),e.setAttribute("aria-invalid",this.invalid?"true":"false");let i=this.explicitAriaLabel;i?e.setAttribute("aria-label",i):e.removeAttribute("aria-label"),this.displayErrorText?e.setAttribute("aria-describedby",this.errorTextId):this.hasSupporting?e.setAttribute("aria-describedby",this.supportingTextId):e.removeAttribute("aria-describedby")}#a(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector('input[type="checkbox"]');if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(!this.effectiveDisabled&&this.checked?this.value:null,this.checked?"checked":"unchecked"),this.effectiveDisabled){this.#o(""),this.#e.setValidity({});return}if(this.invalid){let i=(this.errorText??"").trim();this.#o(i||e?.validationMessage||""),this.#e.setValidity({customError:!0},i||"Please correct this field.",e??void 0);return}if(this.#o(""),this.required&&!this.checked){this.#e.setValidity({valueMissing:!0},"Please turn this setting on.",e??void 0);return}this.#e.setValidity({})}};oa([f],Ee.prototype,"hasSupporting",void 0);oa([f],Ee.prototype,"hasLabel",void 0);oa([f],Ee.prototype,"_displayErrorText",void 0);c({mode:"boolean"})(Ee.prototype,"checked");c({mode:"boolean"})(Ee.prototype,"disabled");G(Ee.prototype);c({mode:"boolean"})(Ee.prototype,"inline");c({mode:"boolean"})(Ee.prototype,"invalid");c({attribute:"error-text"})(Ee.prototype,"errorText");c(Ee.prototype,"name");c(Ee.prototype,"value");c({mode:"boolean"})(Ee.prototype,"required");var Sp={name:"violet-switch",template:rx,styles:ox,shadowOptions:{delegatesFocus:!0}};var nx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},sx=b`
    ${A}

:host{
position:fixed;
inset-inline-start:50%;
inset-block-end:var(--violet-snackbar-inset-block-end,var(--_space-lg));
transform:translateX(-50%);
z-index:var(--_layer-toast);
inline-size:min(var(--violet-snackbar-inline-size,32rem),calc(100vw - (var(--_space-lg) * 2)));
max-inline-size:calc(100vw - (var(--_space-lg) * 2));
color:var(--_text-primary);

--_target-size-natural:var(--violet-size-target-natural,32px);
--_snackbar-padding-inline:var(--violet-snackbar-padding-inline,var(--_space-md));
--_snackbar-padding-block:var(--violet-snackbar-padding-block,var(--_space-sm));
--_snackbar-gap:var(--violet-snackbar-gap,var(--_space-sm));
--_snackbar-radius:var(--violet-snackbar-radius,var(--_radius-lg));
--_snackbar-surface:var(--violet-snackbar-surface,var(--_surface-floating));
--_snackbar-border:var(--violet-snackbar-border,transparent);
--_snackbar-shadow:var(--violet-snackbar-shadow,var(--_shadow-floating));
--_snackbar-emphasis:var(--violet-snackbar-emphasis,var(--_text-primary));
--_snackbar-action:var(--violet-snackbar-action,var(--_text-primary));
--_snackbar-body-size:var(--violet-snackbar-body-size,var(--_body-size));
--_snackbar-body-line:var(--violet-snackbar-body-line,var(--_body-line));
}

:host(:not([open])){
display:none;
}

:host([tone="info"]){
--_snackbar-surface:var(--_surface-card);
}

:host([tone="success"]){
--_snackbar-surface:color-mix(in srgb,var(--violet-color-state-success-background,#dfeae3) 78%,var(--_surface-card));
--_snackbar-border:var(--violet-color-state-success-border,transparent);
--_snackbar-emphasis:var(--violet-color-state-success-text,#2c5e4b);
--_snackbar-action:var(--violet-color-state-success-text,#2c5e4b);
}

:host([tone="warning"]){
--_snackbar-surface:color-mix(in srgb,var(--violet-color-state-warning-background,#f3e8d2) 82%,var(--_surface-card));
--_snackbar-border:var(--violet-color-state-warning-border,transparent);
--_snackbar-emphasis:var(--violet-color-state-warning-text,#92400E);
--_snackbar-action:var(--violet-color-state-warning-text,#92400E);
}

:host([tone="danger"]){
--_snackbar-surface:color-mix(in srgb,var(--violet-color-state-danger-background,#f7e4df) 82%,var(--_surface-card));
--_snackbar-border:var(--violet-color-state-danger-border,transparent);
--_snackbar-emphasis:var(--violet-color-state-danger-text,#c42a1a);
--_snackbar-action:var(--violet-color-state-danger-text,#c42a1a);
}

.frame{
--violet-card-radius:var(--_snackbar-radius);
--violet-card-padding:0;
--violet-card-background:var(--_snackbar-surface);
--violet-card-border-color:var(--_snackbar-border);
--violet-card-shadow:var(--_snackbar-shadow);
}

.layout{
display:flex;
align-items:center;
gap:var(--_snackbar-gap);
min-block-size:var(--_target-size-natural);
padding:var(--_snackbar-padding-block) var(--_snackbar-padding-inline);
}

.message{
display:block;
flex:1 1 auto;
min-inline-size:0;
font-size:var(--_snackbar-body-size);
line-height:var(--_snackbar-body-line);
color:var(--_snackbar-emphasis);
}

.message-copy{
display:block;
}

.message slot::slotted(*){
margin:0;
}

.action{
flex:0 0 auto;
display:inline-flex;
align-items:center;
}

.action[hidden]{
display:none;
}

.action ::slotted(violet-button){
color:var(--_snackbar-action);
--violet-button-padding-inline:var(--_space-sm);
}

.dismiss{
flex:0 0 auto;
color:var(--_snackbar-emphasis);
}

.dismiss[hidden]{
display:none;
}

@media (max-width:480px){
:host{
inset-inline-start:var(--_space-md);
inset-inline-end:var(--_space-md);
transform:none;
inline-size:auto;
max-inline-size:none;
}

.layout{
align-items:start;
}
}

@media (forced-colors:active){




.frame > *{
forced-color-adjust:none;
}


slot{
forced-color-adjust:auto;
color:CanvasText;
}

.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:CanvasText;
box-shadow:none;
}
}
`,ax=h`
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
`,Ft=class extends y{#e=null;constructor(){super(),this.hasAction=!1,this.open=!1,this.tone="default",this.announcement="polite",this.dismissible=!1,this.timeout="6000"}connectedCallback(){super.connectedCallback(),mt(),this.handleActionSlotChange(),this.#t()}disconnectedCallback(){super.disconnectedCallback(),this.#o()}openChanged(e,i){!this.$fastController.isConnected||e===i||(this.#t(),this.$emit("open-change",{open:i}))}timeoutChanged(){this.$fastController.isConnected&&this.#t()}handleActionSlotChange(){this.hasAction=this.#i('slot[name="action"]');let e=this.shadowRoot?.querySelector(".action");e&&(e.hidden=!this.hasAction),this.$fastController.isConnected&&this.#t()}dismiss(e){this.open&&(this.#o(),this.open=!1,this.$emit("dismiss",{reason:e}))}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}#t(){this.#o();let e=Number.parseInt(this.timeout,10);!this.open||this.hasAction||this.dismissible||!Number.isFinite(e)||e<=0||(this.#e=window.setTimeout(()=>{this.dismiss("timeout")},e))}#o(){this.#e!==null&&(window.clearTimeout(this.#e),this.#e=null)}#i(e){let i=this.shadowRoot?.querySelector(e),o=i?.name;return o&&this.querySelector(`[slot="${o}"]`)?!0:(i?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0)}};nx([f],Ft.prototype,"hasAction",void 0);c({mode:"boolean"})(Ft.prototype,"open");c(Ft.prototype,"tone");c(Ft.prototype,"announcement");c({mode:"boolean"})(Ft.prototype,"dismissible");c(Ft.prototype,"timeout");var zp={name:"violet-snackbar",template:ax,styles:sx,shadowOptions:{delegatesFocus:!0}};var lx=b`
    ${V}
    ${A}

:host{
display:inline-flex;
position:relative;
box-sizing:border-box;
align-items:center;
justify-content:center;
min-block-size:var(--_target-size);
min-inline-size:max-content;
max-inline-size:100%;
border:1px solid transparent;
border-radius:0;
background:transparent;
color:var(--_text-secondary);
cursor:pointer;
font-family:inherit;
font-size:var(--_control-body-size);
font-weight:500;
line-height:var(--_type-body-line);
outline:none;
user-select:none;
white-space:nowrap;
transition:
background-color var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard),
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);

--_selection-text:var(--violet-color-control-selected-foreground,#1b5f80);
--_tab-border:color-mix(in srgb,var(--_border-subtle) 88%,transparent);
--_tab-key-background:var(--violet-color-action-secondary-background,var(--_surface-subtle));
--_tab-key-border:var(--violet-color-action-secondary-border,transparent);
--_tab-hover:var(--_tab-key-background);
--_tab-closed-resting:var(--_surface-subtle);
--_tab-indicator-thickness:2px;
--_tab-selected-accent-thickness:var(--_tab-indicator-thickness);
}

:host([hidden]){
display:none;
}

:host([aria-selected="true"]){
color:var(--_text-primary);
}

:host([disabled]),
:host([aria-disabled="true"]){
cursor:not-allowed;
opacity:0.5;
}

:host(:focus-visible){
box-shadow:0 0 0 2px var(--_focus-ring);
z-index:3;
}

.surface{
position:relative;
display:inline-flex;
box-sizing:border-box;
align-items:center;
justify-content:center;
gap:var(--_space-inline-sm);
min-block-size:inherit;
min-inline-size:0;
max-inline-size:100%;
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
padding-block:calc(var(--_space-inline-sm) + 2px) var(--_space-inline-sm);
}

:host([data-appearance="open"]) .surface{
padding-block:var(--_space-inline-sm);
}

.label{
overflow:hidden;
text-overflow:ellipsis;
}

.indicator{
position:absolute;
inset:auto;
inline-size:0;
block-size:0;
border-radius:var(--_radius-round);
background:var(--_selection-text);
opacity:0;
pointer-events:none;
transform:none;
transform-origin:center;
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard);
}

:host([data-appearance="open"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover),
:host([data-appearance="mixed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover){
background:var(--_tab-hover);
color:var(--_text-primary);
}


:host([data-appearance="open"]){
border-radius:var(--_radius-md);
}

:host([data-appearance="open"][aria-selected="true"]){
background:var(--_tab-key-background);
border-color:var(--_tab-key-border);
}



:host([data-appearance="open"][aria-selected="true"]) .indicator{
inset-inline:var(--_space-inline-md);
inset-block-end:3px;
inline-size:auto;
block-size:var(--_tab-indicator-thickness);
opacity:1;
transform:scaleX(1);
}

:host([data-appearance="open"]:not([aria-selected="true"])) .indicator,
:host([data-appearance="mixed"]:not([aria-selected="true"])) .indicator{
transform:scaleX(0.72);
}

:host([data-appearance="closed"]),
:host([data-appearance="mixed"][aria-selected="true"]){
margin-block-end:-1px;
border-color:var(--_tab-border);
border-radius:calc(var(--_radius-md) + 2px) calc(var(--_radius-md) + 2px) 0 0;
}

:host([data-appearance="closed"]){
background:var(--_tab-closed-resting);
}

:host([data-appearance="closed"]:not([aria-selected="true"]):not([aria-disabled="true"]):hover){
background:color-mix(in srgb,var(--_surface-page) 90%,var(--_tab-closed-resting));
color:var(--_text-primary);
}

:host([data-appearance="closed"][aria-selected="true"]),
:host([data-appearance="mixed"][aria-selected="true"]){
background:var(--_surface-page);
border-block-end-width:0;
border-block-end-color:transparent;
z-index:1;
box-shadow:none;
}

:host([data-appearance="closed"][aria-selected="true"]) .indicator,
:host([data-appearance="mixed"][aria-selected="true"]) .indicator{
inset-inline:0;
inset-block-start:auto;
inset-block-end:0;
inline-size:auto;
block-size:var(--_tab-selected-accent-thickness);
opacity:1;
transform:none;
}

:host([data-orientation="vertical"]){
justify-content:flex-start;
text-align:start;
white-space:normal;
}

:host([data-orientation="vertical"]) .surface{
inline-size:100%;
justify-content:flex-start;
padding-inline-start:var(--_space-inline-md);
padding-inline-end:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
}

:host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])){
border-radius:var(--_radius-md);
}

:host([data-orientation="vertical"][data-appearance="open"][aria-selected="true"]) .indicator{
inset-inline-start:3px;
inset-inline-end:auto;
inset-block:var(--_space-inline-sm);
inline-size:var(--_tab-indicator-thickness);
block-size:auto;
transform:scaleY(1);
}

:host([data-orientation="vertical"][data-appearance="open"]:not([aria-selected="true"])) .indicator,
:host([data-orientation="vertical"][data-appearance="mixed"]:not([aria-selected="true"])) .indicator{
transform:scaleY(0.72);
}

:host([data-orientation="vertical"][data-appearance="closed"]),
:host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]){
margin-block-end:0;
margin-inline-end:-1px;
border-radius:calc(var(--_radius-md) + 2px) 0 0 calc(var(--_radius-md) + 2px);
}

:host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]),
:host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]){
border-inline-end-width:0;
border-inline-end-color:transparent;
box-shadow:none;
}

:host([data-orientation="vertical"][data-appearance="closed"][aria-selected="true"]) .indicator,
:host([data-orientation="vertical"][data-appearance="mixed"][aria-selected="true"]) .indicator{
inset-inline-start:0;
inset-inline-end:auto;
inset-block:0;
inline-size:var(--_tab-selected-accent-thickness);
block-size:auto;
opacity:1;
transform:none;
}

@media (forced-colors:active){
:host([data-appearance="open"][aria-selected="true"]) .indicator{
background:Highlight;
}
}
`,cx=h`
    <div class="surface" part="root">
        <span class="label" part="label"><slot></slot></span>
        <span class="indicator" part="indicator" aria-hidden="true"></span>
    </div>
`,fr=class extends y{#e=!1;get effectiveDisabled(){return this.disabled||this.#e}setDisabledFromTabs(e){this.#e=e}syncPresentation(e,i){this.setAttribute("data-appearance",e),this.setAttribute("data-orientation",i)}};c({mode:"boolean"})(fr.prototype,"disabled");var Ep={name:"violet-tab",template:cx,styles:lx};var dx=b`
    ${V}
    ${A}

:host{
display:block;
color:var(--_text-primary);
font-family:inherit;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
outline:none;
}


:host(:focus-visible){
outline:var(--violet-size-focus-ring-width,2px) solid var(--_focus-ring);
outline-offset:2px;
}

:host([hidden]){
display:none;
}

@media (forced-colors:active){
:host(:focus-visible){
outline-color:Highlight;
}
}

.content{
display:grid;
gap:var(--_space-md);
}
`,ux=h`
    <div class="content" part="root">
        <slot></slot>
    </div>
`,Tn=class extends y{},Tp={name:"violet-tab-panel",template:ux,styles:dx};var ra=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},$p=0,hx=b`
    ${V}
    ${A}

:host{
display:grid;
gap:var(--_space-stack-sm);
color:var(--_text-primary);

--_panel-background:var(--_surface-page);
--_panel-border:color-mix(in srgb,var(--_border-subtle) 92%,transparent);
--_panel-shadow:var(--_shadow-control);
--_panel-padding:var(--_space-lg);
}

:host([appearance="closed"]),
:host([appearance="mixed"]){
gap:0;
}

:host([orientation="vertical"]){
grid-template-columns:minmax(max-content,16rem) minmax(0,1fr);
align-items:start;
gap:var(--_space-md);
}





.tablist-shell{
min-inline-size:0;
border-block-end:1px solid transparent;
}

:host([appearance="closed"]) .tablist-shell,
:host([appearance="mixed"]) .tablist-shell{
border-block-end:0;
}

.tablist{
display:flex;
flex-wrap:wrap;
align-items:flex-end;
gap:var(--_space-inline-sm);
min-inline-size:0;
}

:host([appearance="open"]) .tablist{
align-items:center;
}

:host([appearance="closed"]) .tablist{
gap:var(--_space-stack-2xs);
}

:host([orientation="vertical"]) .tablist-shell{
border-block-end:0;
padding-inline-end:var(--_space-inline-sm);
}

:host([orientation="vertical"]) .tablist{
flex-direction:column;
align-items:stretch;
}

.panel-region{
min-inline-size:0;
}

:host([appearance="open"]) .panel-region{
padding-block-start:var(--_space-stack-sm);
}

:host([appearance="closed"]) .panel-region,
:host([appearance="mixed"]) .panel-region{
padding:var(--_panel-padding);
border:1px solid var(--_panel-border);
border-radius:var(--_radius-lg);
background:var(--_panel-background);
box-shadow:var(--_panel-shadow);
}

:host([orientation="horizontal"][appearance="closed"]) .panel-region,
:host([orientation="horizontal"][appearance="mixed"]) .panel-region{
border-start-start-radius:0;
}

:host([orientation="vertical"][appearance="closed"]) .panel-region,
:host([orientation="vertical"][appearance="mixed"]) .panel-region{
border-start-start-radius:0;
}
`,px=h`
    <div class="tablist-shell" part="tablist-shell">
        <div
            class="tablist"
            part="tablist"
            role="tablist"
            aria-label="${t=>t.label||null}"
            aria-orientation="${t=>t.orientation}"
        >
            <slot name="tab" @slotchange="${t=>t.handleTabSlotChange()}"></slot>
        </div>
    </div>
    <div class="panel-region" part="panel-region" ?hidden="${t=>!t.hasPanels}">
        <slot name="tabpanel" @slotchange="${t=>t.handlePanelSlotChange()}"></slot>
    </div>
`;function fx(t){return t.tagName==="VIOLET-TAB"}function mx(t){return t.tagName==="VIOLET-TAB-PANEL"}var Ze=class extends y{#e=e=>{if(this.disabled)return;let i=e.currentTarget;!i||this.#u(i)||(i.focus(),this.activeid=i.id)};#t=e=>{if(this.disabled)return;let i=e,o=i.currentTarget;if(!(!o||this.#u(o)))switch(i.key){case"ArrowLeft":this.orientation==="horizontal"&&(i.preventDefault(),this.#l(this.#p()?1:-1));break;case"ArrowRight":this.orientation==="horizontal"&&(i.preventDefault(),this.#l(this.#p()?-1:1));break;case"ArrowUp":this.orientation==="vertical"&&(i.preventDefault(),this.#l(-1));break;case"ArrowDown":this.orientation==="vertical"&&(i.preventDefault(),this.#l(1));break;case"Home":i.preventDefault(),this.#c("start");break;case"End":i.preventDefault(),this.#c("end");break;case"Enter":case" ":i.preventDefault(),this.activeid=o.id;break}};constructor(){super(),this.tabs=[],this.panels=[],this.hasPanels=!1,this.appearance="open",this.disabled=!1,this.orientation="horizontal",this.activeid="",this.label="",this.activetab=null}connectedCallback(){super.connectedCallback(),customElements.upgrade(this),this.#o(),this.#i(),this.#n(!1)}disconnectedCallback(){this.#s(this.tabs),super.disconnectedCallback()}appearanceChanged(){this.$fastController.isConnected&&this.#n(!1)}disabledChanged(){this.$fastController.isConnected&&this.#n(!1)}orientationChanged(){this.$fastController.isConnected&&this.#n(!1)}activeidChanged(e,i){this.$fastController.isConnected&&this.#n(e!==i)}handleTabSlotChange(){this.#o(),this.#n(!1)}handlePanelSlotChange(){this.#i(),this.#n(!1)}#o(){let e=Array.from(this.children).filter(fx);e.forEach(i=>{i.slot!=="tab"&&(i.slot="tab")}),this.#s(this.tabs),this.tabs=e,this.#r(this.tabs)}#i(){this.panels=Array.from(this.children).filter(mx),this.panels.forEach(e=>{e.slot!=="tabpanel"&&(e.slot="tabpanel")}),this.hasPanels=this.panels.length>0}#r(e){e.forEach(i=>{i.addEventListener("click",this.#e),i.addEventListener("keydown",this.#t)})}#s(e){e.forEach(i=>{i.removeEventListener("click",this.#e),i.removeEventListener("keydown",this.#t)})}#n(e){if(this.tabs.length===0){this.activetab=null,this.hasPanels=this.panels.length>0;return}let i=this.#a(),o=this.tabs[i]??null;this.activetab=o;let r=Math.min(this.tabs.length,this.panels.length);if(this.tabs.forEach((n,s)=>{n.id||(n.id=`violet-tab-${++$p}`),n.slot!=="tab"&&(n.slot="tab"),n.setAttribute("role","tab");let a=s<r?this.panels[s]:null;a&&!a.id&&(a.id=`violet-tab-panel-${++$p}`),a&&a.slot!=="tabpanel"&&(a.slot="tabpanel"),a&&a.setAttribute("role","tabpanel");let l=s===i,d=this.#u(n),u=l&&!d;n.syncPresentation(this.#d(l),this.orientation),n.setDisabledFromTabs(this.disabled),n.setAttribute("aria-disabled",d?"true":"false"),n.setAttribute("aria-selected",l?"true":"false"),n.tabIndex=u?0:-1,a?(n.setAttribute("aria-controls",a.id),a.setAttribute("aria-labelledby",n.id),a.hidden=!l,a.tabIndex=0,a.setAttribute("data-orientation",this.orientation),a.setAttribute("data-appearance",this.appearance)):n.removeAttribute("aria-controls")}),this.panels.forEach((n,s)=>{s>=r&&(n.hidden=!0)}),o&&this.activeid!==o.id){this.activeid=o.id;return}this.hasPanels=this.panels.length>0,e&&o&&this.$emit("change",o)}#a(){let e=this.tabs.findIndex(r=>r.id===this.activeid&&!this.#u(r));if(e>=0)return e;let i=this.tabs.findIndex(r=>r.getAttribute("aria-selected")==="true"&&!this.#u(r));if(i>=0)return i;let o=this.tabs.findIndex(r=>!this.#u(r));return o>=0?o:0}#d(e){return this.appearance==="mixed"?e?"mixed":"open":this.appearance}#l(e){let i=this.tabs.filter(s=>!this.#u(s));if(i.length===0)return;let r=((this.activetab?i.indexOf(this.activetab):0)+e+i.length)%i.length,n=i[r];n&&(n.focus(),this.activeid=n.id)}#c(e){let i=this.tabs.filter(r=>!this.#u(r));if(i.length===0)return;let o=e==="start"?i[0]:i[i.length-1];o&&(o.focus(),this.activeid=o.id)}#u(e){return this.disabled||e.disabled}#p(){return getComputedStyle(this).direction==="rtl"}};ra([f],Ze.prototype,"tabs",void 0);ra([f],Ze.prototype,"panels",void 0);ra([f],Ze.prototype,"hasPanels",void 0);c(Ze.prototype,"appearance");c({mode:"boolean"})(Ze.prototype,"disabled");c(Ze.prototype,"orientation");c(Ze.prototype,"activeid");c(Ze.prototype,"label");var Ip={name:"violet-tabs",template:px,styles:hx};aa();An();function Rn(t){return t?.nodeType===11&&"host"in t}function Mp(t){return t?.nodeType===9}var Ao=null,ca,la,Fn=new WeakMap,Io=new Set,Hp=new WeakMap,Bp=new WeakMap;function da(){return Ao?.presets??sa}function jp(){return Ao?.defaultPreset??mr}function qp(){return Ao!==null?Ao.cssText:ca===void 0?(ua().catch(t=>{console.error("violet-theme: the built-in theme failed to load; the next install retries",t)}),""):ca}function ua(){return la??=(async()=>{await Promise.resolve();let e;try{e=(await Np())?.violetThemeCssText}catch(i){if(!(i instanceof ReferenceError))throw i}if(e===void 0){await new Promise(o=>setTimeout(o,0));let i=await Np();if(i?.violetThemeCssText===void 0)throw new TypeError("violet-theme: built-in theme module did not export violetThemeCssText");e=i.violetThemeCssText}return ca=e,Ao===null&&Gp(),e})().catch(e=>{throw la=void 0,e}),la}var Np=()=>Promise.resolve().then(()=>(Pp(),Lp));function Wp(t){let e;if(Mp(t))e=t;else if(Rn(t))e=t.ownerDocument;else throw new TypeError("violet-theme: the target must be a Document or a ShadowRoot");if(e.defaultView===null)throw new TypeError("violet-theme: this document has no window; a constructed stylesheet cannot be adopted into it");return e}function Kp(t,e){Bp.get(t)!==e&&(t.replaceSync(e),Bp.set(t,e))}function Sx(){for(let t of Io)t.deref()===void 0&&Io.delete(t)}function Up(t){let e=Wp(t),i=Fn.get(e),o=i??new e.defaultView.CSSStyleSheet;return Kp(o,qp()),t.adoptedStyleSheets.includes(o)||(t.adoptedStyleSheets=[...t.adoptedStyleSheets,o]),i===void 0&&(Fn.set(e,o),Hp.set(o,e),Sx(),Io.add(new WeakRef(o))),o}function Gp(){let t=qp();for(let e of Io){let i=e.deref();if(i===void 0){Io.delete(e);continue}try{Kp(i,t)}catch(o){console.error("violet-theme: a runtime sheet could not be rewritten and is no longer updated",o),Io.delete(e);let r=Hp.get(i);r!==void 0&&Fn.get(r)===i&&Fn.delete(r)}}}function Mn(t=document){return Up(t)}function Yp(t,e=document){let i=In(t);return Wp(e),Ao={cssText:i,presets:Object.keys(t.presets),defaultPreset:t.defaultPreset},Gp(),Up(e)}function Vn(){return da()}function ha(){return jp()}function On(t){return typeof t=="string"&&da().includes(t)}function Xp(t){if(t==null||t==="")return jp();if(On(t))return t;throw new RangeError(`Unknown Violet theme preset '${t}'; the installed presets are ${da().join(", ")}`)}function Qp(t,e){let i=Xp(e);return t.setAttribute(Li,""),t.setAttribute($o,i),t}An();var zx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Ex=b`
:host{
display:contents;
}
`,Tx=h`
    <slot></slot>
`,vr=class extends y{connectedCallback(){super.connectedCallback();let e=this.getRootNode();Mn(Rn(e)?e:this.ownerDocument),this.setAttribute(Li,""),this.applyPreset()}presetChanged(){this.$fastController.isConnected&&this.applyPreset()}applyPreset(){let e=this.getAttribute("preset")||this.preset||ha();On(e)||console.warn(`violet-theme: the preset '${e}' is not in the installed theme set (${Vn().join(", ")})`),this.setAttribute($o,e)}};zx([c],vr.prototype,"preset",void 0);var Jp={name:"violet-theme",template:Tx,styles:Ex};yo();var ef=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Zp=0,$x=b`
    ${A}

:host{
display:inline-block;
position:relative;

--_tip-border-width:var(--violet-teaching-tip-border-width,var(--_card-border-width,1px));
--_tip-padding:var(--violet-teaching-tip-padding,var(--_space-md));
--_tip-max-width:var(--violet-teaching-tip-max-width,320px);
--_tip-radius:var(--violet-teaching-tip-radius,var(--_radius-lg));
--_tip-gap:var(--violet-teaching-tip-gap,var(--_space-sm));
--_tip-background:var(--violet-teaching-tip-background,var(--_surface-card));
--_tip-shadow:var(--violet-teaching-tip-shadow,var(--_shadow-floating));
--_tip-border-color:var(--violet-teaching-tip-border-color,var(--_border-subtle));
}

.anchor{
display:inline-block;
}

.tip{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;
padding:0;
border:var(--_tip-border-width) solid var(--_tip-border-color);
border-radius:var(--_tip-radius);
background:var(--_tip-background);
box-shadow:var(--_tip-shadow);
color:inherit;
font-family:inherit;
max-inline-size:var(--_tip-max-width);
inline-size:var(--_tip-max-width);
z-index:var(--_layer-popover);

opacity:0;
transform:scale(0.96);
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard),
display var(--_duration-fast) var(--_easing-standard) allow-discrete,
overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
}

.tip:popover-open{
opacity:1;
transform:scale(1);

@starting-style{
opacity:0;
transform:scale(0.96);
}
}

@supports (anchor-name:--violet-anchor) and (position-area:block-end center) and (position-try-fallbacks:flip-block){
:host([positioning="above"]) .tip{
position-area:block-start center;
margin-block-end:var(--_tip-gap);
position-try-fallbacks:flip-block;
}

:host([positioning="below"]) .tip,
:host(:not([positioning])) .tip{
position-area:block-end center;
margin-block-start:var(--_tip-gap);
position-try-fallbacks:flip-block;
}

:host([positioning="before"]) .tip{
position-area:center left;
margin-inline-end:var(--_tip-gap);
position-try-fallbacks:flip-inline;
}

:host([positioning="after"]) .tip{
position-area:center right;
margin-inline-start:var(--_tip-gap);
position-try-fallbacks:flip-inline;
}
}

.header{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:var(--_tip-padding);
padding-block-end:0;
}

.header[hidden]{
display:none;
}

.title{
flex:1;
font-weight:600;
font-size:13px;
min-inline-size:0;
}

.close-button{
flex-shrink:0;
margin-inline-start:auto;
}

.body{
padding:var(--_tip-padding);
font-size:12px;
line-height:16px;
}

.footer{
display:flex;
align-items:center;
gap:var(--_space-sm);
padding:var(--_tip-padding);
padding-block-start:0;
}

.footer[hidden]{
display:none;
}

.step-indicator{
font-size:11px;
color:var(--_text-secondary);
margin-inline-end:auto;
}

.step-indicator[hidden]{
display:none;
}

@media (forced-colors:active){
.tip{
forced-color-adjust:none;
border:var(--_tip-border-width) solid ButtonText;
background:Canvas;
box-shadow:none;
}
}
`,Ix=h`
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
`,Be=class extends y{#e=null;#t=null;#o=!1;#i=new It;constructor(){super(),this.hasTitle=!1,this.hasFooter=!1,this.content="",this.positioning="below",this.open=!1,this.noCloseButton=!1,this.currentStep=0,this.totalSteps=0;let e=Zp;Zp+=1,this.tipId=`violet-teaching-tip-${e}`,this.titleId=`violet-teaching-tip-title-${e}`,this.anchorName=Tt("violet-teaching-tip",e)}get#r(){return this.shadowRoot?.querySelector(".tip")??null}get#s(){return this.shadowRoot?.querySelector(".anchor")??null}get#n(){return this.#t??this.#s}show(){this.open=!0}hide(){this.open=!1}connectedCallback(){super.connectedCallback();let e=this.#r;e&&e.addEventListener("toggle",this.#a),this.#c(),this.#d(),this.#p(),this.open&&this.#h()}disconnectedCallback(){super.disconnectedCallback();let e=this.#r;e&&e.removeEventListener("toggle",this.#a),this.#i.stop(e),this.#u()}openChanged(){this.$fastController.isConnected&&(this.open?this.#h():this.#m(),this.#p())}positioningChanged(){this.open&&this.#i.update()}anchorChanged(){this.$fastController.isConnected&&(this.#u(),this.#c(),this.#d(),this.#o?this.#p():this.handleSlotChange(),this.open&&this.#l())}handleSlotChange(){if(this.#o)return;let i=this.shadowRoot?.querySelector("slot:not([name])")?.assignedElements({flatten:!0})??[];this.#e instanceof HTMLElement&&this.#f(this.#e),this.#e=i[0]??null,this.#p()}handleTitleSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="title"]');this.hasTitle=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}handleFooterSlotChange(){let e=this.shadowRoot?.querySelector('slot[name="footer"]');this.hasFooter=(e?.assignedNodes({flatten:!0})??[]).some(i=>i.nodeType===Node.TEXT_NODE?!!i.textContent?.trim():!0)}#a=e=>{let o=e.newState==="open";this.open=o,o?(this.#d(),this.#l()):this.#i.stop(this.#r),this.#p(),this.$emit("open-change",{open:o}),o||this.$emit("dismiss")};#d(){$t(this.#s,this.#t,this.#r,this.anchorName)}#l(){this.#i.start(()=>this.#n,()=>this.#r,()=>[this.positioning,"below","center",getComputedStyle(this).getPropertyValue("--_tip-gap"),this,8],!!this.#t)}#c(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#e instanceof HTMLElement&&this.#e!==e&&this.#f(this.#e),this.#t=e,this.#e=e,this.#o=!0)}#u(){!this.#o||!this.#t||(this.#f(this.#t),this.#e===this.#t&&(this.#e=null),this.#t=null,this.#o=!1)}#p(){if(!(this.#e instanceof HTMLElement))return;this.#e.setAttribute("aria-haspopup","dialog"),this.#e.setAttribute("aria-expanded",String(this.open));let e=this.shadowRoot;e&&"referenceTarget"in ShadowRoot.prototype?(e.referenceTarget=this.tipId,this.id||(this.id=`${this.tipId}-host`),this.#e.setAttribute("aria-controls",this.id)):this.#e.removeAttribute("aria-controls")}#f(e){e.removeAttribute("aria-haspopup"),e.removeAttribute("aria-expanded"),e.removeAttribute("aria-controls")}#h(){let e=this.#r;if(e){try{e.showPopover()}catch{e.toggleAttribute("popover-open",!0),e.style.display="block"}this.#d(),this.#l()}}#m(){let e=this.#r;if(e){this.#i.stop(e);try{e.hidePopover()}catch{e.removeAttribute("popover-open"),e.style.display=""}}}};ef([f],Be.prototype,"hasTitle",void 0);ef([f],Be.prototype,"hasFooter",void 0);c(Be.prototype,"content");c(Be.prototype,"positioning");c({mode:"boolean"})(Be.prototype,"open");c(Be.prototype,"anchor");c({attribute:"no-close-button",mode:"boolean"})(Be.prototype,"noCloseButton");c({attribute:"current-step",converter:{fromView:t=>Number.parseInt(t,10)||0,toView:t=>String(t)}})(Be.prototype,"currentStep");c({attribute:"total-steps",converter:{fromView:t=>Number.parseInt(t,10)||0,toView:t=>String(t)}})(Be.prototype,"totalSteps");var tf={name:"violet-teaching-tip",template:Ix,styles:$x};var Ax=b`
    ${A}

:host{
display:inline;
--_text-font-size:var(--_body-size);
--_text-line-height:var(--_body-line);
--_text-font-weight:var(--violet-type-body-weight,400);
--_text-color:var(--_text-primary);
}

:host([variant="label"]){
--_text-font-size:var(--violet-type-label-size,13px);
--_text-line-height:var(--violet-type-label-line,16px);
--_text-font-weight:var(--violet-type-label-weight,500);
}

:host([variant="caption"]){
--_text-font-size:var(--_caption-size);
--_text-line-height:var(--_caption-line);
--_text-font-weight:var(--violet-type-caption-weight,400);
}

:host([variant="title-sm"]){
--_text-font-size:var(--violet-type-heading-section-size,18px);
--_text-line-height:var(--violet-type-heading-section-line,24px);
--_text-font-weight:var(--violet-type-heading-section-weight,600);
}

:host([variant="title-md"]){
--_text-font-size:var(--violet-type-heading-page-size,24px);
--_text-line-height:var(--violet-type-heading-page-line,32px);
--_text-font-weight:var(--violet-type-heading-page-weight,600);
}

:host([tone="secondary"]){
--_text-color:var(--_text-secondary);
}

:host([tone="muted"]){
--_text-color:var(--_text-muted);
}

:host([tone="success"]){
--_text-color:var(--violet-color-state-success-text);
}

:host([tone="warning"]){
--_text-color:var(--violet-color-state-warning-text);
}

:host([tone="danger"]){
--_text-color:var(--violet-color-state-danger-text);
}

.root{
margin:0;
color:var(--_text-color);
font-family:inherit;
font-size:var(--_text-font-size);
font-weight:var(--_text-font-weight);
line-height:var(--_text-line-height);
letter-spacing:normal;
}


:host([variant="title-sm"]) .root,
:host([variant="title-md"]) .root{
font-family:var(--violet-font-family-heading,var(--violet-font-family,var(--violet-font-family-body)));
letter-spacing:-0.01em;
}

.root.truncate{
display:block;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}

.inline{
display:inline;
}

.block{
display:block;
}
`,Qt=t=>`root ${t.as==="span"||t.as==="small"||t.as==="strong"||t.as==="label"?"inline":"block"}${t.truncate?" truncate":""}`,Rx=h`
    ${g(t=>t.as==="p",h`<p class="${Qt}"><slot></slot></p>`)}
    ${g(t=>t.as==="small",h`<small class="${Qt}"><slot></slot></small>`)}
    ${g(t=>t.as==="strong",h`<strong class="${Qt}"><slot></slot></strong>`)}
    ${g(t=>t.as==="label",h`<label class="${Qt}"><slot></slot></label>`)}
    ${g(t=>t.as==="h1",h`<h1 class="${Qt}"><slot></slot></h1>`)}
    ${g(t=>t.as==="h2",h`<h2 class="${Qt}"><slot></slot></h2>`)}
    ${g(t=>t.as==="h3",h`<h3 class="${Qt}"><slot></slot></h3>`)}
    ${g(t=>t.as==="h4",h`<h4 class="${Qt}"><slot></slot></h4>`)}
    ${g(t=>t.as==="span",h`<span class="${Qt}"><slot></slot></span>`)}
`,gi=class extends y{constructor(){super(),this.as="span",this.variant="body",this.tone="default",this.truncate=!1}};c(gi.prototype,"as");c(gi.prototype,"variant");c(gi.prototype,"tone");c({mode:"boolean"})(gi.prototype,"truncate");var of={name:"violet-text",template:Rx,styles:Ax,shadowOptions:{delegatesFocus:!0}};var Dx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Fx={fromView(t){let e=Number(t);return Number.isFinite(e)&&e>0?e:4},toView(t){return String(t)}},Mx={fromView(t){if(t==null||t==="")return null;let e=Number(t);return Number.isInteger(e)&&e>=0?e:null},toView(t){return t==null?null:String(t)}},Vx=b`
    ${V}

:host{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
--_space-layout-sm:var(--violet-space-layout-panel,12px);
}

.field{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-frame{
box-sizing:border-box;
display:flex;
align-items:flex-start;
inline-size:100%;
min-inline-size:0;
min-block-size:calc(var(--_target-size) * 2 + var(--_space-layout-sm));
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
padding-block:calc(var(--_target-size) * 0.25);
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
font-family:inherit;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control{
flex:1 1 auto;
min-inline-size:0;
min-block-size:calc(var(--_target-size) * 1.5);
margin:0;
padding:0;
border:0;
background:transparent;
color:var(--_field-text);
box-shadow:none;
font-family:inherit;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
resize:vertical;
}

.control::placeholder{
color:var(--_field-placeholder);
}

.control:focus{
outline:none;
}

.control-frame:hover{
box-shadow:var(--_field-shadow-hover);
}

.control-frame:focus-within{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}






:host([readonly]){
--_field-border:var(--_field-border-readonly);
--_field-placeholder:var(--_text-secondary);
}

:host([readonly]) .control-frame{
background:var(--_field-background-readonly);
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
opacity:0.5;
cursor:not-allowed;
}

:host([disabled]) .control,
:host(:disabled) .control{
cursor:not-allowed;
}

:host([invalid]) .control-frame{
border-color:var(--_danger-border);
}

slot[name="before"]{
display:inline-flex;
align-items:flex-start;
flex:0 0 auto;
color:var(--_text-muted);
padding-block-start:calc((var(--_type-body-line) - 1em) / 2);
}

::slotted([slot="before"]){
margin-inline-end:var(--_space-inline-sm);
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
margin-block-start:var(--_space-field-gap);
}

.supporting{
color:var(--_text-muted);
}

.error{
color:var(--_danger-text);
}

@media (forced-colors:active){
.control-frame{
border-color:ButtonText;
}

.control-frame:focus-within{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
border-color:GrayText;
}
}
`,Ox=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
                aria-describedby="${t=>t.displayErrorText?t.errorId:t.supportingText?t.supportingId:void 0}"
                :value="${t=>t.value??""}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?readonly="${t=>t.readonly}"
                ?required="${t=>t.required}"
                aria-invalid="${t=>t.invalid?"true":"false"}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            ></textarea>
        </div>
        ${g(t=>!t.displayErrorText&&!!t.supportingText,h`
                <p id="${t=>t.supportingId}" class="supporting" part="supporting-text">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p id="${t=>t.errorId}" class="error" part="error-message" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,rf=0,ve=class extends y{static{this.formAssociated=!0}#e;#t;#o;get displayErrorText(){return this._displayErrorText}constructor(){super(),this.#t=!1,this._displayErrorText="",this.#e=this.attachInternals(),rf+=1,this.inputId=`violet-text-area-${rf}`,this.supportingId=`${this.inputId}-supporting`,this.errorId=`${this.inputId}-error`,this.label="",this.placeholder="",this.value="",this.supportingText="",this.errorText="",this.maxLength=null,this.rows=4,this.disabled=!1,this.readonly=!1,this.invalid=!1,this.name="",this.required=!1,this.#o=""}connectedCallback(){super.connectedCallback(),this.#o=this.getAttribute("value")??this.value??"",this.#s(),this.#i()}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.value=i?.value??"",this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#o,this.#s(),this.#i()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}valueChanged(){this.#s(),this.#i()}disabledChanged(){this.#s(),this.#i()}invalidChanged(){this.#s(),this.#i()}errorTextChanged(){this.#s(),this.#i()}readonlyChanged(){this.#s(),this.#i()}requiredChanged(){this.#s(),this.#i()}#i(){this.#t||!this.$fastController.isConnected||(this.#t=!0,M.enqueue(()=>{M.enqueue(()=>{this.#t=!1,this.#s()})}))}#r(e){this._displayErrorText!==e&&(this._displayErrorText=e)}#s(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector("textarea"),i=this.value??"";if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:i),this.effectiveDisabled||this.readonly){this.#r(""),this.#e.setValidity({});return}if(this.invalid){let o=(this.errorText??"").trim();this.#r(o||e?.validationMessage||""),this.#e.setValidity({customError:!0},o||"Please correct this field.",e??void 0);return}if(this.#r(""),this.required&&!i.trim()){this.#e.setValidity({valueMissing:!0},"Please fill out this field.",e??void 0);return}this.#e.setValidity({})}};Dx([f],ve.prototype,"_displayErrorText",void 0);c(ve.prototype,"label");c(ve.prototype,"placeholder");c({mode:"fromView"})(ve.prototype,"value");c({attribute:"supporting-text"})(ve.prototype,"supportingText");c({attribute:"error-text"})(ve.prototype,"errorText");c({attribute:"maxlength",converter:Mx})(ve.prototype,"maxLength");c({converter:Fx})(ve.prototype,"rows");c({mode:"boolean"})(ve.prototype,"disabled");G(ve.prototype);c({mode:"boolean"})(ve.prototype,"readonly");c({mode:"boolean"})(ve.prototype,"invalid");c(ve.prototype,"name");c({mode:"boolean"})(ve.prototype,"required");var nf={name:"violet-text-area",template:Ox,styles:Vx,shadowOptions:{delegatesFocus:!0}};var Lx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Px=b`
    ${V}

:host{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
}

.field{
display:grid;
grid-template-columns:minmax(0,1fr);
min-inline-size:0;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-frame{
box-sizing:border-box;
display:flex;
align-items:center;
inline-size:100%;
min-inline-size:0;
block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
padding-block:0;
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
font-family:inherit;
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control{
flex:1 1 auto;
min-inline-size:0;
border:0;
background:transparent;
color:var(--_field-text);
box-shadow:none;
font-family:inherit;
font-size:var(--_control-body-size);
line-height:1;
}

.control::placeholder{
color:var(--_field-placeholder);
}

.control:focus{
outline:none;
}

.control-frame:hover{
box-shadow:var(--_field-shadow-hover);
}

.control-frame:focus-within{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}






:host([readonly]){
--_field-border:var(--_field-border-readonly);
--_field-placeholder:var(--_text-secondary);
}

:host([readonly]) .control-frame{
background:var(--_field-background-readonly);
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
opacity:0.5;
cursor:not-allowed;
}

:host([disabled]) .control,
:host(:disabled) .control{
cursor:not-allowed;
}

:host([invalid]) .control-frame{
border-color:var(--_danger-border);
}

slot[name="before"]{
display:inline-flex;
align-items:center;
flex:0 0 auto;
color:var(--_text-muted);
}

::slotted([slot="before"]){
margin-inline-end:var(--_space-inline-sm);
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
margin-block-start:var(--_space-field-gap);
}

.supporting{
color:var(--_text-muted);
}

.error{
color:var(--_danger-text);
}

@media (forced-colors:active){
.control-frame{
border-color:ButtonText;
}

.control-frame:focus-within{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
border-color:GrayText;
}
}
`,Bx=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
        ${g(t=>!t.displayErrorText&&!!t.supportingText,h`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>
            `)}
    </div>
`,sf=0,Z=class extends y{static{this.formAssociated=!0}#e;#t;#o;#i;#r;get displayErrorText(){return this._displayErrorText}constructor(){super(),this.#t=new MutationObserver(()=>this.#a()),this.#o=()=>this.#d(),this.#i=!1,this._displayErrorText="",this.#e=this.attachInternals(),sf+=1,this.inputId=`violet-text-field-${sf}`,this.supportingId=`${this.inputId}-supporting`,this.errorId=`${this.inputId}-error`,this.label="",this.placeholder="",this.value="",this.type="text",this.supportingText="",this.errorText="",this.disabled=!1,this.readonly=!1,this.invalid=!1,this.name="",this.required=!1,this.#r=""}connectedCallback(){super.connectedCallback(),this.#s(),this.#r=this.getAttribute("value")??this.value??"",this.#l(),this.#d(),this.#t.observe(this,{attributes:!0,attributeFilter:["aria-describedby"]}),this.addEventListener("focusin",this.#o),this.#a()}disconnectedCallback(){super.disconnectedCallback(),this.#t.disconnect(),this.removeEventListener("focusin",this.#o)}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#l(),this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#r,this.#s(!0),this.#l()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}valueChanged(){this.#s(),this.#l(),this.#a()}#s(e=!1){let i=this.shadowRoot?.querySelector("input.control"),o=this.value??"";i&&(e||i.value!==o)&&(i.value=o)}typeChanged(){this.#a()}minChanged(){this.#a()}maxChanged(){this.#a()}stepChanged(){this.#a()}minLengthChanged(){this.#a()}maxLengthChanged(){this.#a()}patternChanged(){this.#a()}supportingTextChanged(){this.#a()}errorTextChanged(){this.#l(),this.#a()}#n(e){this._displayErrorText!==e&&(this._displayErrorText=e,this.$fastController.isConnected&&M.enqueue(()=>{M.enqueue(()=>{this.#d()})}))}disabledChanged(){this.#l(),this.#a()}invalidChanged(){this.#l(),this.#a()}readonlyChanged(){this.#l(),this.#a()}requiredChanged(){this.#l(),this.#a()}#a(){this.#i||!this.$fastController.isConnected||(this.#i=!0,M.enqueue(()=>{M.enqueue(()=>{this.#i=!1,this.#l(),this.#d()})}))}#d(){let e=this.shadowRoot?.querySelector("input");if(!e)return;let i=[],o=this.getRootNode(),r=(this.getAttribute("aria-describedby")??"").split(/\s+/).filter(Boolean);for(let d of r){let u=o.getElementById?.(d)??null;u&&!i.includes(u)&&i.push(u)}let n=this.displayErrorText?this.shadowRoot?.getElementById(this.errorId)??null:null,s=n?null:this.shadowRoot?.getElementById(this.supportingId)??null,a=n??s;if(a&&i.push(a),"ariaDescribedByElements"in e){e.removeAttribute("aria-describedby"),e.ariaDescribedByElements=i.length?i:null;return}a?e.setAttribute("aria-describedby",a.id):e.removeAttribute("aria-describedby")}#l(){if(!this.$fastController.isConnected)return;let e=this.shadowRoot?.querySelector("input"),i=this.value??"";if(this.#e.ariaInvalid=this.invalid?"true":"false",this.#e.setFormValue(this.effectiveDisabled?null:i),this.effectiveDisabled||this.readonly){this.#n(""),this.#e.setValidity({});return}if(this.invalid){let l=(this.errorText??"").trim();this.#n(l||e?.validationMessage||""),this.#e.setValidity({customError:!0},l||"Please correct this field.",e??void 0);return}if(this.#n(""),this.required&&!i.trim()){this.#e.setValidity({valueMissing:!0},"Please fill out this field.",e??void 0);return}if(!e){this.#e.setValidity({});return}let o=e.validity,r=i.length,n=o.tooShort||this.minLength!=null&&r>0&&r<this.minLength,s=o.tooLong||this.maxLength!=null&&r>this.maxLength;if(o.valid&&!n&&!s){this.#e.setValidity({});return}let a=e.validationMessage;!a&&n?a=`Please lengthen this text to ${this.minLength} characters or more.`:!a&&s&&(a=`Please shorten this text to ${this.maxLength} characters or less.`),this.#e.setValidity({valueMissing:o.valueMissing,typeMismatch:o.typeMismatch,patternMismatch:o.patternMismatch,tooLong:s,tooShort:n,rangeUnderflow:o.rangeUnderflow,rangeOverflow:o.rangeOverflow,stepMismatch:o.stepMismatch,badInput:o.badInput,customError:o.customError},a,e)}};Lx([f],Z.prototype,"_displayErrorText",void 0);c(Z.prototype,"label");c(Z.prototype,"placeholder");c({mode:"fromView"})(Z.prototype,"value");c(Z.prototype,"type");c(Z.prototype,"min");c(Z.prototype,"max");c(Z.prototype,"step");c({attribute:"minlength",converter:Sr})(Z.prototype,"minLength");c({attribute:"maxlength",converter:Sr})(Z.prototype,"maxLength");c(Z.prototype,"pattern");c(Z.prototype,"autocomplete");c({attribute:"inputmode"})(Z.prototype,"inputMode");c({attribute:"supporting-text"})(Z.prototype,"supportingText");c({attribute:"error-text"})(Z.prototype,"errorText");c({mode:"boolean"})(Z.prototype,"disabled");G(Z.prototype);c({mode:"boolean"})(Z.prototype,"readonly");c({mode:"boolean"})(Z.prototype,"invalid");c(Z.prototype,"name");c({mode:"boolean"})(Z.prototype,"required");var af={name:"violet-text-field",template:Bx,styles:Px,shadowOptions:{delegatesFocus:!0}};var lf=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Ln=0,Nx=b`
    ${V}

:host{
display:grid;
}

:host([size="compact"]){
--violet-target-size:var(--_target-size-compact);
--violet-control-label-size:var(--_type-label-size-compact);
--violet-control-body-size:var(--_type-body-size-compact);
--violet-control-caption-size:var(--_type-caption-size-compact);
}

:host([size="natural"]){
--violet-target-size:var(--_target-size-natural);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

:host([size="comfortable"]){
--violet-target-size:var(--_target-size-comfortable);
--violet-control-label-size:var(--_type-label-size);
--violet-control-body-size:var(--_type-body-size);
--violet-control-caption-size:var(--_type-caption-size);
}

.field{
display:grid;
gap:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.control-frame{
box-sizing:border-box;
display:flex;
align-items:center;
gap:var(--_space-inline-sm);
inline-size:100%;
block-size:var(--_target-size);
min-block-size:var(--_target-size);
padding-inline:max(var(--_space-inline-md),calc(var(--_target-size) * 0.375));
border:1px solid var(--_border-subtle);
border-radius:var(--_radius-md);
background:var(--_field-background);
color:var(--_field-text);
box-shadow:var(--_field-shadow);
transition:
border-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-base) var(--_easing-standard);
}

.control-frame:hover{
box-shadow:var(--_field-shadow-hover);
}

.control-frame:focus-within{
border-color:var(--_field-border-focus);
box-shadow:var(--_field-shadow-focus);
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
opacity:0.5;
cursor:not-allowed;
}

:host([invalid]) .control-frame{
border-color:var(--_danger-border);
}

.input{
appearance:none;
-webkit-appearance:none;
flex:1 1 auto;
min-inline-size:0;
border:0;
background:transparent;
color:inherit;
font:inherit;
font-size:var(--_control-body-size);
line-height:1;
outline:none;
}

.input::-webkit-calendar-picker-indicator,
.input::-webkit-clear-button,
.input::-webkit-inner-spin-button{
display:none;
opacity:0;
pointer-events:none;
}

.input::-webkit-date-and-time-value{
min-block-size:auto;
padding:0;
text-align:start;
}

.icon{
display:inline-grid;
place-items:center;
color:var(--_text-muted);
pointer-events:none;
}

.icon violet-icon{
--violet-icon-size:max(0.9rem,calc(var(--_target-size) * 0.33));
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-field-gap);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-field-gap);
}

@media (forced-colors:active){
.control-frame{
border-color:ButtonText;
}

.control-frame:focus-within{
outline:2px solid Highlight;
outline-offset:1px;
}

:host([disabled]) .control-frame,
:host(:disabled) .control-frame{
border-color:GrayText;
}
}
`,Hx=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`<label class="label" part="label" for="${t=>t.inputId}">${t=>t.label}</label>`)}
        <div class="control-frame" part="control-frame">
            <input
                id="${t=>t.inputId}"
                class="input"
                part="input"
                type="time"
                name="${t=>t.name}"
                min="${t=>t.min}"
                max="${t=>t.max}"
                step="${t=>t.stepValue}"
                ?disabled="${t=>t.effectiveDisabled}"
                ?required="${t=>t.required}"
                aria-describedby="${t=>t.describedBy||null}"
                aria-invalid="${t=>!t.effectiveDisabled&&t.invalid?"true":"false"}"
                @input="${(t,e)=>t.handleInput(e.event)}"
                @change="${(t,e)=>t.handleCommit(e.event)}"
            />
            <span class="icon" aria-hidden="true">
                <violet-icon icon="system/clock" decorative></violet-icon>
            </span>
        </div>
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`<p class="supporting" part="supporting-text" id="${t=>t.supportingId}">${t=>t.supportingText}</p>`)}
        ${g(t=>!!t.displayErrorText,h`<p class="error" part="error-message" id="${t=>t.errorId}" role="alert">${t=>t.displayErrorText}</p>`)}
    </div>
`,he=class extends y{static{this.formAssociated=!0}#e;#t;constructor(){super(),this.#t="",this.nativeValidationMessage="",this.#e=this.attachInternals(),this.validationMessageText="",this.label="",this.supportingText="",this.errorText="",this.value="",this.name="",this.min="",this.max="",this.step="60",this.required=!1,this.disabled=!1,this.invalid=!1,this.size="natural",Ln+=1,this.inputId=`violet-time-picker-input-${Ln}`,this.supportingId=`violet-time-picker-supporting-${Ln}`,this.errorId=`violet-time-picker-error-${Ln}`}connectedCallback(){super.connectedCallback(),this.#o(),this.#t=this.value,this.#i()}get form(){return this.#e.form}get validity(){return this.#e.validity}get validationMessage(){return this.#e.validationMessage}get willValidate(){return this.#e.willValidate}get describedBy(){return this.displayErrorText?this.errorId:this.supportingText?this.supportingId:""}get displayErrorText(){return Q({invalid:this.invalid,disabled:this.effectiveDisabled,errorText:this.errorText,fallbackValidationMessage:this.nativeValidationMessage})}get stepValue(){return this.step||"60"}valueChanged(){this.#o(),this.#i()}disabledChanged(){this.#i()}requiredChanged(){this.#i()}stepChanged(){this.#i()}invalidChanged(){this.#i()}errorTextChanged(){this.#i()}minChanged(){this.#i()}maxChanged(){this.#i()}handleInput(e){e.stopPropagation();let i=e.currentTarget;this.value=i?.value??"",this.#i(),this.$emit("input",{value:this.value})}handleCommit(e){let i=e.currentTarget;this.value=i?.value??"",this.#i(),this.$emit("change",{value:this.value})}formStateRestoreCallback(e){typeof e=="string"&&(this.value=e)}formResetCallback(){this.value=this.#t,this.#o(!0),this.#i()}checkValidity(){return this.#e.checkValidity()}reportValidity(){return this.#e.reportValidity()}get inputElement(){return this.shadowRoot?.querySelector('input[type="time"]')}#o(e=!1){let i=this.inputElement;i&&(e||i.value!==this.value)&&(i.value=this.value)}#i(){if(this.effectiveDisabled){this.nativeValidationMessage="",this.validationMessageText="",this.#e.setFormValue(null),this.#e.setValidity({});return}let e=this.inputElement,i=this.required&&!this.value,o=this.value?!Ss(this.value):!1,r=(this.errorText??"").trim(),n=this.invalid?r||"Enter a valid time.":"",s=O=>{let L=Ss(O);return L?L.hour*3600+L.minute*60+L.second:null},a=this.value&&!o?s(this.value):null,l=s(this.min),d=s(this.max),u=a!==null&&l!==null&&a<l,p=a!==null&&d!==null&&a>d,v=this.stepValue??"",k=v.toLowerCase()==="any",S=!k&&/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)?Number(v):Number.NaN,R=k?Number.NaN:Number.isFinite(S)&&S>0?S:60,_=a!==null?a-(l??0):0,$=a!==null&&Number.isFinite(R)&&R>0&&Math.abs(_-Math.round(_/R)*R)>1e-6,D=i?"Please choose a time.":o?"Enter a valid time.":u?`Choose a time at or after ${this.min}.`:p?`Choose a time at or before ${this.max}.`:$?"Choose a valid time increment.":"";this.nativeValidationMessage=D,this.validationMessageText=n||D,this.#e.setFormValue(this.value||null),this.#e.setValidity({valueMissing:i,badInput:o,rangeUnderflow:u,rangeOverflow:p,stepMismatch:$,customError:!!n},this.validationMessageText,e??void 0)}};lf([f],he.prototype,"validationMessageText",void 0);lf([f],he.prototype,"nativeValidationMessage",void 0);c(he.prototype,"label");c({attribute:"supporting-text"})(he.prototype,"supportingText");c({attribute:"error-text"})(he.prototype,"errorText");c(he.prototype,"value");c(he.prototype,"name");c(he.prototype,"min");c(he.prototype,"max");c(he.prototype,"step");c({mode:"boolean"})(he.prototype,"required");c({mode:"boolean"})(he.prototype,"disabled");G(he.prototype);c({mode:"boolean"})(he.prototype,"invalid");c(he.prototype,"size");var cf={name:"violet-time-picker",template:Hx,styles:Nx,shadowOptions:{delegatesFocus:!0}};yo();var jx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},df=0;function uf(t){return(t.getAttribute("aria-describedby")??"").split(/\s+/).filter(Boolean)}var qx=b`
    ${A}

:host{
display:inline-block;
position:relative;

--_tooltip-border-width:var(--violet-tooltip-border-width,var(--_card-border-width,1px));
--_tooltip-font-size:var(--violet-tooltip-font-size,12px);
--_tooltip-line-height:var(--violet-tooltip-line-height,16px);
--_tooltip-max-width:var(--violet-tooltip-max-width,240px);
--_tooltip-gap:var(--violet-tooltip-gap,var(--_space-sm));
--_tooltip-radius:var(--violet-tooltip-radius,calc(var(--_radius-md) - 2px));

--_tooltip-background:var(
--violet-tooltip-background,
var(--violet-color-action-primary-background,var(--_surface-card))
);
--_tooltip-shadow:var(--violet-tooltip-shadow,var(--_shadow-card));
--_tooltip-border-color:var(--violet-tooltip-border-color,transparent);
}

.anchor{
display:inline-block;
}

.tooltip{
box-sizing:border-box;
position:fixed;
inset:unset;
margin:0;

inline-size:max-content;
padding:calc(var(--_space-sm) / 2) var(--_space-sm);
border:var(--_tooltip-border-width) solid var(--_tooltip-border-color);
border-radius:var(--_tooltip-radius);
background:var(--_tooltip-background);
box-shadow:var(--_tooltip-shadow);
color:var(--violet-color-action-primary-text,#f4f0ea);
font-family:inherit;
font-size:var(--_tooltip-font-size);
line-height:var(--_tooltip-line-height);
max-inline-size:var(--_tooltip-max-width);
pointer-events:none;
z-index:var(--_layer-popover);
opacity:0;
transform:scale(0.96);
transition:
opacity var(--_duration-fast) var(--_easing-standard),
transform var(--_duration-fast) var(--_easing-standard),
display var(--_duration-fast) var(--_easing-standard) allow-discrete,
overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
}

.tooltip:popover-open{
opacity:1;
transform:scale(1);
pointer-events:auto;

@starting-style{
opacity:0;
transform:scale(0.96);
}
}

@supports (anchor-name:--violet-anchor) and (position-area:block-end center) and (position-try-fallbacks:flip-block){
:host([positioning="above"]) .tooltip,
:host(:not([positioning])) .tooltip{
position-area:block-start center;
margin-block-end:var(--_tooltip-gap);
position-try-fallbacks:flip-block;
}

:host([positioning="below"]) .tooltip{
position-area:block-end center;
margin-block-start:var(--_tooltip-gap);
position-try-fallbacks:flip-block;
}

:host([positioning="before"]) .tooltip{
position-area:center left;
margin-inline-end:var(--_tooltip-gap);
position-try-fallbacks:flip-inline;
}

:host([positioning="after"]) .tooltip{
position-area:center right;
margin-inline-start:var(--_tooltip-gap);
position-try-fallbacks:flip-inline;
}
}

@media (forced-colors:active){
.tooltip{
forced-color-adjust:none;
border:var(--_tooltip-border-width) solid ButtonText;
background:Canvas;
color:CanvasText;
box-shadow:none;
}
}
`,Wx=h`
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
`,Mt=class extends y{#e=null;#t=null;#o=null;#i=null;#r=!1;#s=new It;#n=[];#a=null;constructor(){super(),this.content="",this.positioning="above",this.delay=250,this.open=!1;let e=df;df+=1,this.tooltipId=`violet-tooltip-${e}`,this.anchorName=Tt("violet-tooltip",e)}get#d(){return this.shadowRoot?.querySelector(".tooltip")??null}get#l(){return this.shadowRoot?.querySelector(".anchor")??null}get#c(){return this.#i??this.#l}connectedCallback(){super.connectedCallback();let e=this.#l;e&&(e.addEventListener("mouseenter",this.#m),e.addEventListener("mouseleave",this.#g),e.addEventListener("focusin",this.#z),e.addEventListener("focusout",this.#E));let i=this.#d;i&&(i.addEventListener("mouseenter",this.#v),i.addEventListener("mouseleave",this.#b),i.addEventListener("toggle",this.#_)),this.#f(),this.#p(),this.open&&this.#$()}disconnectedCallback(){super.disconnectedCallback(),this.#S(),this.#s.stop(this.#d),this.#h()}openChanged(){this.$fastController.isConnected&&(this.open?this.#$():this.#k())}positioningChanged(){this.open&&this.#s.update()}anchorChanged(){this.$fastController.isConnected&&(this.#h(),this.#f(),this.#p(),this.#r||this.handleSlotChange(),this.open&&this.#C())}contentChanged(){this.syncDescription()}handleSlotChange(){if(this.#r)return;let i=this.shadowRoot?.querySelector("slot:not([name])")?.assignedElements({flatten:!0})??[];this.#u(),this.#o=i[0]??null,this.syncDescription()}syncDescription(){let e=this.#o;if(this.#u(),!e)return;let o=this.shadowRoot?.querySelector('slot[name="content"]')?.assignedElements({flatten:!0})??[];if(o.length>0){let r=o.map((s,a)=>(s.id||(s.id=`${this.tooltipId}-content-${a}`),s.id)),n=uf(e).filter(s=>!r.includes(s));e.setAttribute("aria-describedby",[...n,...r].join(" ")),this.#n=r}else this.content&&(e.setAttribute("aria-description",this.content),this.#a=this.content)}#u(){let e=this.#o;if(e&&this.#n.length>0){let i=uf(e).filter(o=>!this.#n.includes(o));i.length>0?e.setAttribute("aria-describedby",i.join(" ")):e.removeAttribute("aria-describedby")}e&&this.#a!==null&&e.getAttribute("aria-description")===this.#a&&e.removeAttribute("aria-description"),this.#n=[],this.#a=null}#p(){$t(this.#l,this.#i,this.#d,this.anchorName)}#f(){if(!this.anchor)return;let e=document.getElementById(this.anchor);e instanceof HTMLElement&&(this.#u(),this.#i=e,this.#o=e,this.syncDescription(),e.addEventListener("mouseenter",this.#m),e.addEventListener("mouseleave",this.#g),e.addEventListener("focusin",this.#z),e.addEventListener("focusout",this.#E),this.#r=!0)}#h(){!this.#r||!this.#o||!this.#i||(this.#o.removeEventListener("mouseenter",this.#m),this.#o.removeEventListener("mouseleave",this.#g),this.#o.removeEventListener("focusin",this.#z),this.#o.removeEventListener("focusout",this.#E),this.#u(),this.#i=null,this.#o=null,this.#r=!1)}#m=()=>{this.#S(),this.#e=setTimeout(()=>{this.open=!0},this.delay)};#g=()=>{this.#S(),this.#t=setTimeout(()=>{this.open=!1},100)};#v=()=>{this.#t&&(clearTimeout(this.#t),this.#t=null)};#b=()=>{this.#t=setTimeout(()=>{this.open=!1},100)};#_=e=>{e.newState==="closed"&&this.open&&(this.#S(),this.open=!1)};#z=()=>{this.#S(),this.open=!0};#E=()=>{this.#S(),this.open=!1};#$(){let e=this.#d;if(e){try{e.showPopover()}catch{e.toggleAttribute("popover-open",!0),e.style.display="block"}this.#p(),this.#C()}}#C(){this.#s.start(()=>this.#c,()=>this.#d,()=>[this.positioning,"above","center",getComputedStyle(this).getPropertyValue("--_tooltip-gap"),this,8],!!this.#i)}#k(){let e=this.#d;if(e){this.#s.stop(e);try{e.hidePopover()}catch{e.removeAttribute("popover-open"),e.style.display=""}}}#S(){this.#e&&(clearTimeout(this.#e),this.#e=null),this.#t&&(clearTimeout(this.#t),this.#t=null)}};jx([f],Mt.prototype,"anchor",void 0);c(Mt.prototype,"content");c(Mt.prototype,"positioning");c({converter:{fromView:t=>Number.parseInt(t,10)||250,toView:t=>String(t)}})(Mt.prototype,"delay");c({mode:"boolean"})(Mt.prototype,"open");c(Mt.prototype,"anchor");var hf={name:"violet-tooltip",template:Wx,styles:qx};var pa=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},Kx=b`
    ${A}

:host{
position:fixed;
inset-block-end:var(--violet-toast-inset-block-end,var(--_space-lg));
inset-inline-end:var(--violet-toast-inset-inline-end,var(--_space-lg));
z-index:var(--_layer-toast);
inline-size:min(var(--violet-toast-inline-size,24rem),calc(100vw - (var(--_space-lg) * 2)));
max-inline-size:calc(100vw - (var(--_space-lg) * 2));
color:var(--_text-primary);
--_toast-padding:var(--violet-toast-padding,var(--_space-md));
--_toast-gap:var(--violet-toast-gap,var(--_space-md));
--_toast-radius:var(--violet-toast-radius,var(--_radius-lg));
--_toast-surface:var(--violet-toast-surface,var(--_surface-floating));
--_toast-border:var(--violet-toast-border,transparent);
--_toast-shadow:var(--violet-toast-shadow,var(--_shadow-floating));
--_toast-emphasis:var(--violet-toast-emphasis,var(--_text-secondary));
--_toast-icon-size:var(--violet-toast-icon-size,1rem);
--_toast-title-size:var(--violet-toast-title-size,var(--_body-size));
--_toast-title-line:var(--violet-toast-title-line,var(--_body-line));
--_toast-body-size:var(--violet-toast-body-size,var(--_body-size));
--_toast-body-line:var(--violet-toast-body-line,var(--_body-line));
}

:host(:not([open])){
display:none;
}

:host([tone="success"]){
--_toast-surface:color-mix(in srgb,var(--violet-color-state-success-background,#dfeae3) 78%,var(--_surface-card));
--_toast-border:var(--violet-color-state-success-border,transparent);
--_toast-emphasis:var(--violet-color-state-success-text,#2c5e4b);
}

:host([tone="warning"]){
--_toast-surface:color-mix(in srgb,var(--violet-color-state-warning-background,#f3e8d2) 82%,var(--_surface-card));
--_toast-border:var(--violet-color-state-warning-border,transparent);
--_toast-emphasis:var(--violet-color-state-warning-text,#92400E);
}

:host([tone="danger"]){
--_toast-surface:color-mix(in srgb,var(--violet-color-state-danger-background,#f7e4df) 82%,var(--_surface-card));
--_toast-border:var(--violet-color-state-danger-border,transparent);
--_toast-emphasis:var(--violet-color-state-danger-text,#c42a1a);
}

.frame{
--violet-card-radius:var(--_toast-radius);
--violet-card-padding:var(--_toast-padding);
--violet-card-background:var(--_toast-surface);
--violet-card-border-color:var(--_toast-border);
--violet-card-shadow:var(--_toast-shadow);
}

.layout{
display:grid;
grid-template-columns:auto minmax(0,1fr) auto;
gap:var(--_toast-gap);
align-items:start;
}


.leading{
display:inline-flex;
align-items:center;
justify-content:center;
inline-size:var(--_toast-icon-size);
block-size:var(--_toast-title-line);
color:var(--_toast-emphasis);
flex:0 0 auto;
}

.leading[hidden]{
display:none;
}

.icon-slot{
display:contents;
}

.leading ::slotted(violet-icon){
--violet-icon-size:var(--_toast-icon-size);
color:currentColor;
}

.body{
display:grid;
gap:var(--_space-stack-2xs);
min-inline-size:0;
font-size:var(--_toast-body-size);
line-height:var(--_toast-body-line);
}

.copy{
display:grid;
gap:var(--_space-stack-2xs);
min-inline-size:0;
}

.title{
margin:0;
color:var(--_toast-emphasis);
font-size:var(--_toast-title-size);
line-height:var(--_toast-title-line);
font-weight:500;
}

.title[hidden]{
display:none;
}

.content{
display:grid;
gap:var(--_space-stack-2xs);
}

.content slot::slotted(*){
margin:0;
}

.actions{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:var(--_space-sm);
margin-block-start:var(--_space-stack-xs);
}

.actions[hidden]{
display:none;
}

.actions slot::slotted(*){
margin:0;
}

.dismiss{
color:var(--_toast-emphasis);
}

.dismiss[hidden]{
display:none;
}

@media (forced-colors:active){




.frame > *{
forced-color-adjust:none;
}


slot{
forced-color-adjust:auto;
color:CanvasText;
}

.frame::part(root){
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:CanvasText;
box-shadow:none;
}

.leading{
color:ButtonText;
}
}
`,Ux=h`
    <violet-card class="frame" part="root" appearance="outline" padding="medium">
        <div class="layout" part="layout">
            <span class="leading" part="icon" ?hidden="${t=>!t.showLeading}">
                <slot class="icon-slot" name="icon" @slotchange="${t=>t.handleIconSlotChange()}"></slot>
                ${t=>t.hasIcon?h``:t.defaultIconTemplate}
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
`,et=class extends y{#e=null;constructor(){super(),this.hasTitle=!1,this.hasActions=!1,this.hasIcon=!1,this.open=!1,this.tone="default",this.announcement="polite",this.dismissible=!0,this.timeout="5000"}connectedCallback(){super.connectedCallback(),ti(),mt(),We(),Ki(),this.handleTitleSlotChange(),this.handleActionsSlotChange(),this.handleIconSlotChange(),this.#t()}disconnectedCallback(){super.disconnectedCallback(),this.#o()}openChanged(e,i){!this.$fastController.isConnected||e===i||(this.#t(),this.$emit("open-change",{open:i}))}timeoutChanged(){this.$fastController.isConnected&&this.#t()}handleTitleSlotChange(){this.hasTitle=this.#i('slot[name="title"]')}handleActionsSlotChange(){this.hasActions=this.#i('slot[name="actions"]');let e=this.shadowRoot?.querySelector(".actions");e&&(e.hidden=!this.hasActions),this.$fastController.isConnected&&this.#t()}handleIconSlotChange(){this.hasIcon=this.#i('slot[name="icon"]')}dismiss(e){this.open&&(this.#o(),this.open=!1,this.$emit("dismiss",{reason:e}))}get showLeading(){return this.hasIcon||this.tone==="success"||this.tone==="warning"||this.tone==="danger"}get liveRegionRole(){return this.announcement==="assertive"?"alert":this.announcement==="polite"?"status":null}get liveRegionPoliteness(){return this.announcement==="assertive"?"assertive":this.announcement==="polite"?"polite":null}get defaultIconTemplate(){return this.tone==="success"?h`<violet-icon icon="system/checkmark" decorative></violet-icon>`:this.tone==="danger"?h`<violet-icon icon="system/dismiss" decorative></violet-icon>`:this.tone==="warning"?h`<violet-icon icon="system/warning" decorative></violet-icon>`:h``}#t(){this.#o();let e=Number.parseInt(this.timeout,10);!this.open||this.hasActions||!Number.isFinite(e)||e<=0||(this.#e=window.setTimeout(()=>{this.dismiss("timeout")},e))}#o(){this.#e!==null&&(window.clearTimeout(this.#e),this.#e=null)}#i(e){let i=this.shadowRoot?.querySelector(e),o=i?.name;return o&&this.querySelector(`[slot="${o}"]`)?!0:(i?.assignedNodes({flatten:!0})??[]).some(r=>r.nodeType===Node.TEXT_NODE?!!r.textContent?.trim():!0)}};pa([f],et.prototype,"hasTitle",void 0);pa([f],et.prototype,"hasActions",void 0);pa([f],et.prototype,"hasIcon",void 0);c({mode:"boolean"})(et.prototype,"open");c(et.prototype,"tone");c(et.prototype,"announcement");c({mode:"boolean"})(et.prototype,"dismissible");c(et.prototype,"timeout");var pf={name:"violet-toast",template:Ux,styles:Kx,shadowOptions:{delegatesFocus:!0}};var Gx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},ff=0;function fa(t){return t instanceof HTMLElement&&t.tagName.toLowerCase()==="violet-tree-item"}var Yx=b`
    ${V}

:host{
display:block;
outline:none;

--_tree-level:1;
--_tree-indent-step:var(--violet-tree-indent-step,1rem);
--_tree-row-radius:var(--violet-tree-row-radius,var(--_radius-md));
--_tree-row-gap:var(--violet-tree-row-gap,var(--_space-inline-md));
--_tree-row-padding-inline:var(--violet-tree-row-padding-inline,var(--_space-inline-md));
--_tree-row-padding-block:var(--violet-tree-row-padding-block,var(--_space-stack-2xs));

--_tree-row-background-selected:var(
--violet-tree-row-background-selected,
var(--violet-color-surface-selected,var(--_surface-subtle))
);
--_tree-row-background-hover:var(--violet-tree-row-background-hover,var(--_surface-subtle));
--_tree-row-border-selected:var(--violet-tree-row-border-selected,transparent);
--_tree-toggle-size:var(--violet-tree-toggle-size,0.875rem);
}

.row{
box-sizing:border-box;
display:grid;
grid-template-columns:auto auto minmax(0,1fr) auto;
align-items:center;
gap:var(--_tree-row-gap);
min-block-size:var(--_target-size);
padding-block:var(--_tree-row-padding-block);
padding-inline-end:var(--_tree-row-padding-inline);
padding-inline-start:calc(
var(--_tree-row-padding-inline) + (var(--_tree-level,1) - 1) * var(--_tree-indent-step)
);
border-radius:var(--_tree-row-radius);
color:var(--violet-color-text-primary,#181b1a);
cursor:pointer;
font-size:var(--_control-body-size);
line-height:var(--_type-body-line);
transition:
background-color var(--_duration-fast) var(--_easing-standard),
box-shadow var(--_duration-fast) var(--_easing-standard),
color var(--_duration-fast) var(--_easing-standard);
}

.row:hover{
background:var(--_tree-row-background-hover);
}

:host([selected]) .row{
background:var(--_tree-row-background-selected);
box-shadow:inset 0 0 0 1px var(--_tree-row-border-selected);
}

:host(:focus-visible) .row{
box-shadow:inset 0 0 0 2px var(--_focus-ring);
}

:host([selected]:focus-visible) .row{
box-shadow:
inset 0 0 0 1px var(--_tree-row-border-selected),
inset 0 0 0 3px var(--_focus-ring);
}

:host([disabled]) .row{
color:var(--_text-muted);
cursor:not-allowed;
opacity:0.5;
}

.toggle{
inline-size:var(--_tree-toggle-size);
block-size:var(--_tree-toggle-size);
display:inline-flex;
align-items:center;
justify-content:center;
border-radius:var(--_radius-md);
color:var(--_text-secondary);
user-select:none;
}

:host(:not([aria-expanded])) .toggle{
opacity:0;
}

.toggle-icon{
--violet-icon-size:0.75rem;
transition:transform var(--_duration-fast) var(--_easing-standard);
}

:host([expanded]) .toggle-icon{
transform:rotate(90deg);
}

.label{
min-inline-size:0;
color:inherit;
}

.meta{
color:var(--_text-muted);
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.group{
display:grid;
gap:0;
}

.group[hidden]{
display:none;
}

::slotted(violet-tree-item){
margin-block-start:0;
}

@media (forced-colors:active){
.row{
forced-color-adjust:none;
color:ButtonText;
}

.row:hover,
:host([selected]) .row{
background:Canvas;
}

:host([selected]) .row{
box-shadow:inset 0 0 0 1px Highlight;
}

:host(:focus-visible) .row{
box-shadow:inset 0 0 0 2px Highlight;
}
}
`,Xx=h`
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
            <slot ${jr("labelSlot")}></slot>
        </span>
        <span class="meta" part="meta">
            <slot name="meta"></slot>
        </span>
    </div>
    <div class="group" part="group" role="group" ?hidden="${t=>!t.expanded||t.childItems.length===0}">
        <slot name="item" ${jr("itemSlot")} @slotchange="${t=>t.handleItemSlotChange()}"></slot>
    </div>
`,Vt=class extends y{#e;#t;#o=1;#i=1;#r=1;constructor(){super(),this.#e=`violet-tree-item-${ff}`,ff+=1,this.childItems=[],this.expanded=!1,this.expandable=!1,this.selected=!1,this.disabled=!1,this.value="",this.#t=new MutationObserver(()=>{this.syncStructureFromDom()})}connectedCallback(){super.connectedCallback(),this.hasAttribute("tabindex")||(this.tabIndex=-1),this.refreshNestingSlot(),this.id||=this.#e,this.#t.observe(this,{childList:!0}),queueMicrotask(()=>{this.syncStructureFromDom()}),this.#s()}disconnectedCallback(){this.#t.disconnect(),super.disconnectedCallback()}expandedChanged(){this.#s()}expandableChanged(){this.#s()}selectedChanged(){this.#s()}disabledChanged(){this.#s()}childItemsChanged(){this.#s()}get hasChildren(){return this.expandable||this.childItems.length>0}get parentItem(){return fa(this.parentElement)?this.parentElement:null}get resolvedValue(){return this.value||this.textLabel}get textLabel(){return(this.labelSlot?.assignedNodes({flatten:!0})??[]).map(o=>o.textContent??"").join(" ").replace(/\s+/g," ").trim()||this.getAttribute("aria-label")||""}focusItem(){this.focus()}setActiveFromTree(e){this.tabIndex=e?0:-1}setTreePosition(e,i,o){this.#o=e,this.#i=i,this.#r=o,this.style.setProperty("--_tree-level",String(e)),this.#s()}refreshNestingSlot(){if(fa(this.parentElement)){this.setAttribute("slot","item");return}this.getAttribute("slot")==="item"&&this.removeAttribute("slot")}handleItemSlotChange(){this.#n()}syncStructureFromDom(){this.#n();for(let e of this.childItems)e.syncStructureFromDom()}handleRowClick(e){if(this.disabled)return;if(e.composedPath().some(o=>o instanceof HTMLElement&&o.dataset.treeToggle==="true"&&this.hasChildren)){this.$emit("toggle-request",{expanded:!this.expanded});return}this.$emit("select-request",{value:this.resolvedValue})}#s(){this.isConnected&&(this.setAttribute("role","treeitem"),this.setAttribute("aria-level",String(this.#o)),this.setAttribute("aria-posinset",String(this.#i)),this.setAttribute("aria-setsize",String(this.#r)),this.setAttribute("aria-selected",String(this.selected)),this.disabled?this.setAttribute("aria-disabled","true"):this.removeAttribute("aria-disabled"),this.hasChildren?this.setAttribute("aria-expanded",String(this.expanded)):this.removeAttribute("aria-expanded"))}#n(){this.childItems=Array.from(this.children).filter(fa);for(let e of this.childItems)e.setAttribute("slot","item")}};Gx([f],Vt.prototype,"childItems",void 0);c({mode:"boolean"})(Vt.prototype,"expanded");c({mode:"boolean"})(Vt.prototype,"expandable");c({mode:"boolean"})(Vt.prototype,"selected");c({mode:"boolean"})(Vt.prototype,"disabled");c(Vt.prototype,"value");var mf={name:"violet-tree-item",template:Xx,styles:Yx};var Qx=function(t,e,i,o){var r=arguments.length,n=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,i):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")n=Reflect.decorate(t,e,i,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(n=(r<3?s(n):r>3?s(e,i,n):s(e,i))||n);return r>3&&n&&Object.defineProperty(e,i,n),n},vf=0;function gf(t){return t instanceof HTMLElement&&t.tagName.toLowerCase()==="violet-tree-item"}function ma(t){return Array.isArray(t.childItems)?t.childItems:[]}var Jx=b`
    ${V}

:host{
display:grid;

--_tree-surface-padding:var(--violet-tree-surface-padding,var(--_space-stack-xs));
--_tree-surface-radius:var(--violet-tree-surface-radius,var(--_radius-lg));
--_tree-surface-background:var(--violet-tree-surface-background,var(--_surface-card));
--_tree-surface-border:var(--violet-tree-surface-border,transparent);
}

.field{
display:grid;
gap:0;
min-inline-size:0;
}

.label{
color:var(--_text-secondary);
font-size:var(--_control-label-size);
font-weight:var(--_type-label-weight);
line-height:var(--_type-label-line);
margin-block-end:var(--_space-field-gap);
}

.surface{
min-inline-size:0;
padding:0;
border:0;
border-radius:0;
background:transparent;
box-shadow:none;
}

:host([appearance="framed"]) .surface{
padding:var(--_tree-surface-padding);
border:1px solid var(--_tree-surface-border);
border-radius:var(--_tree-surface-radius);
background:var(--_tree-surface-background);
box-shadow:var(--_shadow-control);
}

.tree{
display:grid;
gap:0;
outline:none;
}

.supporting,
.error{
margin:0;
font-size:var(--_control-caption-size);
line-height:var(--_type-caption-line);
}

.supporting{
color:var(--_text-muted);
margin-block-start:var(--_space-stack-2xs);
}

.error{
color:var(--_danger-text);
margin-block-start:var(--_space-stack-2xs);
}

@media (forced-colors:active){
.surface{
forced-color-adjust:none;
border-color:ButtonText;
background:Canvas;
color:ButtonText;
box-shadow:none;
}
}
`,Zx=h`
    <div class="field" part="field">
        ${g(t=>!!t.label,h`
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
                aria-invalid="${t=>t.invalid?"true":"false"}"
            >
                <slot @slotchange="${t=>t.handleSlotChange()}"></slot>
            </div>
        </div>
        ${g(t=>!!t.supportingText&&!t.displayErrorText,h`
                <p class="supporting" part="supporting-text" id="${t=>t.supportingTextId}">
                    ${t=>t.supportingText}
                </p>
            `)}
        ${g(t=>!!t.displayErrorText,h`
                <p class="error" part="error-message" id="${t=>t.errorTextId}" role="alert">
                    ${t=>t.displayErrorText}
                </p>
            `)}
    </div>
`,tt=class extends y{#e;#t=null;#o="";#i=0;#r=!1;constructor(){super(),this.#e=vf,vf+=1,this.rootItems=[],this.label="",this.supportingText="",this.errorText="",this.invalid=!1,this.value="",this.ariaLabel="Tree",this.appearance="plain"}get labelId(){return`violet-tree-label-${this.#e}`}get supportingTextId(){return`violet-tree-supporting-${this.#e}`}get errorTextId(){return`violet-tree-error-${this.#e}`}get displayErrorText(){return Q({invalid:this.invalid,errorText:this.errorText})}get describedBy(){return this.displayErrorText?this.errorTextId:this.supportingText?this.supportingTextId:null}connectedCallback(){super.connectedCallback(),this.addEventListener("select-request",this.handleSelectRequest),this.addEventListener("toggle-request",this.handleToggleRequest),this.addEventListener("keydown",this.handleKeydown),this.addEventListener("focusin",this.handleFocusIn),queueMicrotask(()=>{this.handleSlotChange()})}disconnectedCallback(){this.removeEventListener("select-request",this.handleSelectRequest),this.removeEventListener("toggle-request",this.handleToggleRequest),this.removeEventListener("keydown",this.handleKeydown),this.removeEventListener("focusin",this.handleFocusIn),window.clearTimeout(this.#i),super.disconnectedCallback()}valueChanged(){if(this.#r)return;let e=this.#a().find(i=>i.resolvedValue===this.value)??null;this.#u(e,!1),this.#l()}handleSlotChange(){this.rootItems=this.#n();for(let o of this.rootItems)o.syncStructureFromDom();let e=this.#a(),i=this.value?e.find(o=>o.resolvedValue===this.value)??null:e.find(o=>o.selected)??null;i?this.#u(i,!1):e.length>0&&this.#u(null,!1),this.#l()}handleSelectRequest(e){let i=this.#p(e);!i||i.disabled||(this.#c(i,!0),this.#u(i,!0),this.#l())}handleToggleRequest(e){let i=this.#p(e);!i||i.disabled||!i.hasChildren||(this.#s(i,e.detail?.expanded??!i.expanded),this.#c(i,!0),this.#l())}handleFocusIn(e){let i=this.#p(e);!i||i.disabled||this.#c(i,!1)}handleKeydown(e){let i=this.#p(e)??this.#t??this.#d()[0]??null;if(!i)return;let o=this.#d(),r=o.indexOf(i);switch(fe(e.key,this)){case"ArrowDown":{let n=o[r+1];if(!n)return;e.preventDefault(),this.#c(n,!0);break}case"ArrowUp":{let n=o[r-1];if(!n)return;e.preventDefault(),this.#c(n,!0);break}case"ArrowRight":{if(e.preventDefault(),i.hasChildren&&!i.expanded){this.#s(i,!0),this.#l();return}if(i.hasChildren&&i.expanded){let n=i.childItems[0];n&&this.#c(n,!0)}break}case"ArrowLeft":{if(e.preventDefault(),i.hasChildren&&i.expanded){this.#s(i,!1),this.#l();return}let n=i.parentItem;n&&this.#c(n,!0);break}case"Home":{e.preventDefault();let n=o[0];n&&this.#c(n,!0);break}case"End":{e.preventDefault();let n=o.at(-1);n&&this.#c(n,!0);break}case"Enter":case" ":{e.preventDefault(),this.#u(i,!0),this.#l();break}default:{if(e.altKey||e.ctrlKey||e.metaKey||e.key.length!==1)return;this.#f(e.key,i);break}}}#s(e,i){e.expanded!==i&&(e.expanded=i,this.$emit("expanded-change",{value:e.resolvedValue,itemId:e.id,expanded:i}))}#n(){return(this.shadowRoot?.querySelector("slot")?.assignedElements()??[]).filter(gf)}#a(){let e=[],i=o=>{for(let r of o){e.push(r);let n=ma(r);n.length>0&&i(n)}};return i(this.rootItems),e}#d(){let e=[],i=o=>{for(let r of o){e.push(r);let n=ma(r);r.expanded&&n.length>0&&i(n)}};return i(this.rootItems),e}#l(){let e=(n,s)=>{n.forEach((a,l)=>{a.setTreePosition(s,l+1,n.length);let d=ma(a);d.length>0&&e(d,s+1)})};e(this.rootItems,1);let i=this.#d(),o=this.#a().find(n=>n.selected)??null;(!this.#t||!i.includes(this.#t))&&(this.#t=o&&i.includes(o)?o:i[0]??null);let r=this.#a();for(let n of r)n.setActiveFromTree(n===this.#t)}#c(e,i){this.#t=e;for(let o of this.#a())o.setActiveFromTree(o===e);i&&e.focusItem()}#u(e,i){let o=this.#a(),r=e&&!e.disabled?e:null;for(let n of o)n.selected=n===r;this.#r=!0,this.value=r?.resolvedValue??"",this.#r=!1,i&&r&&this.$emit("change",{value:r.resolvedValue,itemId:r.id})}#p(e){return e.composedPath().find(gf)??null}#f(e,i){let o=this.#d();if(o.length===0)return;this.#o+=e.toLowerCase(),window.clearTimeout(this.#i),this.#i=window.setTimeout(()=>{this.#o=""},400);let r=Math.max(o.indexOf(i),0);for(let n=1;n<=o.length;n+=1){let s=o[(r+n)%o.length];if(s.textLabel.toLowerCase().startsWith(this.#o)){this.#c(s,!0);return}}}};Qx([f],tt.prototype,"rootItems",void 0);c(tt.prototype,"label");c({attribute:"supporting-text"})(tt.prototype,"supportingText");c({attribute:"error-text"})(tt.prototype,"errorText");c({mode:"boolean"})(tt.prototype,"invalid");c(tt.prototype,"value");c({attribute:"aria-label",mode:"fromView"})(tt.prototype,"ariaLabel");c(tt.prototype,"appearance");var bf={name:"violet-tree",template:Zx,styles:Jx};var yf=new WeakMap;async function x(t,e,i=customElements,o){let r=yf.get(t);r===void 0&&(r=ye.compose(t,e),yf.set(t,r)),(await r).define(i,o)}async function Ne(t=customElements){await x(we,bc,t)}await Ne();async function He(t=customElements){await x(yt,Ec,t)}await He();async function B(t=customElements){await x(Ri,Dh,t)}await B();async function pe(t=customElements){await x(pi,Fh,t)}await pe();async function ew(t=customElements){await Ne(t),await He(t),await B(t),await pe(t),await x(st,yc,t)}await ew();async function tw(t=customElements){await B(t),await x(bt,xc,t)}await tw();async function va(t=customElements){await x(Ci,_c,t)}await va();async function iw(t=customElements){await va(t),await x(Ji,kc,t)}await iw();async function gr(t=customElements){await x(Zi,Cc,t)}await gr();async function ga(t=customElements){await gr(t),await x(eo,Sc,t)}await ga();async function br(t=customElements){await x($e,Fc,t)}await br();async function ow(t=customElements){await B(t),await pe(t),ft(),await x(wt,Oc,t)}await ow();async function ba(t=customElements){await x(_e,Lc,t)}await ba();async function ya(t=customElements){await x(jt,qc,t)}await ya();async function rw(t=customElements){await ya(t),await B(t),ft(),await x(le,jc,t)}await rw();async function xa(t=customElements){await B(t),await Ne(t),await He(t),await x(Si,Kc,t)}await xa();async function wa(t=customElements){await x(ve,nf,t)}await wa();async function nw(t=customElements){await B(t),await pe(t),await wa(t),await x(Ge,Uc,t)}await nw();async function sw(t=customElements){await x(Qo,Gc,t)}await sw();async function aw(t=customElements){await x(ci,Xc,t)}await aw();async function lw(t=customElements){await x(qt,Jc,t)}await lw();async function cw(t=customElements){await x(Jo,Zc,t)}await cw();async function dw(t=customElements){await B(t),await x(Ct,ed,t)}await dw();async function uw(t=customElements){await x(Zo,td,t)}await uw();async function hw(t=customElements){await B(t),await x(zi,id,t)}await hw();async function pw(t=customElements){await B(t),await x(St,od,t)}await pw();async function fw(t=customElements){await B(t),await He(t),await xa(t),await x(Wt,nd,t)}await fw();async function mw(t=customElements){await B(t),await He(t),await x(Ei,sd,t)}await mw();async function vw(t=customElements){await B(t),await pe(t),mt(),await x(Ye,cd,t)}await vw();async function yr(t=customElements){await x(Ve,np,t)}await yr();async function _a(t=customElements){await x(Z,af,t)}await _a();async function gw(t=customElements){await ba(t),await B(t),await yr(t),await _a(t),wl(),_l(),await x(H,Qu,t)}await gw();async function ka(t=customElements){await Ne(t),await pe(t),await B(t),await x(se,kh,t)}await ka();async function Ca(t=customElements){await x(Qe,Ah,t)}await Ca();async function bw(t=customElements){await ka(t),await pe(t),await B(t),await Ca(t),We(),ii(),await x(Ut,ih,t)}await bw();async function Sa(t=customElements){await x(Di,Wh,t)}await Sa();async function je(t=customElements){await x(At,Gh,t,Yh)}await je();async function Pi(t=customElements){await Sa(t),await je(t),await x(Dt,dp,t,up)}await Pi();async function yw(t=customElements){await Pi(t),await je(t),await x(zt,nh,t)}await yw();async function za(t=customElements){await x(dt,Jh,t)}await za();async function xw(t=customElements){await Pi(t),await je(t),await za(t),await x(at,lh,t)}await xw();async function ww(t=customElements){await x(Pe,ch,t)}await ww();async function _w(t=customElements){await Pi(t),await je(t),await x(Xe,hh,t)}await _w();async function kw(t=customElements){await x(Gt,mh,t)}await kw();async function Cw(t=customElements){await br(t),await B(t),Ar(),await x(re,vh,t)}await Cw();async function Sw(t=customElements){await br(t),await B(t),Ar(),await x(me,gh,t)}await Sw();async function zw(t=customElements){await x(Ii,bh,t)}await zw();async function Ea(t=customElements){await x(gi,of,t)}await Ea();async function Ta(t=customElements){await Ea(t),await x(Et,xh,t)}await Ta();async function $a(t=customElements){await x(Oi,kp,t)}await $a();async function xr(t=customElements){await B(t),ft(),await x(Vt,mf,t)}await xr();async function Ia(t=customElements){await xr(t),await x(tt,bf,t)}await Ia();async function Ew(t=customElements){await gr(t),await ga(t),await Ne(t),await Ta(t),await B(t),await $a(t),await xr(t),await Ia(t),ii(),yl(),await x(ne,_h,t)}await Ew();async function Tw(t=customElements){await x(Y,Ih,t)}await Tw();async function $w(t=customElements){await x(xo,Hh,t)}await $w();async function Iw(t=customElements){await x(pr,jh,t)}await Iw();async function Aw(t=customElements){await x(Rt,ep,t)}await Aw();async function Rw(t=customElements){await x(fi,ip,t)}await Rw();async function Dw(t=customElements){await x(Fi,rp,t)}await Dw();async function Fw(t=customElements){await yr(t),await x(ze,ap,t)}await Fw();async function Mw(t=customElements){await je(t),await x(ke,pp,t,fp)}await Mw();async function Vw(t=customElements){await je(t),await x(de,mp,t)}await Vw();async function Aa(t=customElements){await x(Vi,vp,t)}await Aa();async function Ow(t=customElements){await Aa(t),await x(Ie,bp,t)}await Ow();async function Lw(t=customElements){await x(ae,yp,t)}await Lw();async function Pw(t=customElements){await x(ue,wp,t)}await Pw();async function Bw(t=customElements){await x(vi,_p,t)}await Bw();async function Nw(t=customElements){await x(Ee,Sp,t)}await Nw();async function Hw(t=customElements){await Ne(t),await He(t),await B(t),await pe(t),await x(Ft,zp,t)}await Hw();async function Ra(t=customElements){await x(fr,Ep,t)}await Ra();async function Da(t=customElements){await x(Tn,Tp,t)}await Da();async function jw(t=customElements){await Ra(t),await Da(t),await x(Ze,Ip,t)}await jw();async function qw(t=customElements){await x(vr,Jp,t)}await qw();async function Ww(t=customElements){await B(t),await pe(t),mt(),await x(Be,tf,t)}await Ww();async function Kw(t=customElements){await B(t),bl(),await x(he,cf,t)}await Kw();async function Uw(t=customElements){await x(Mt,hf,t)}await Uw();async function Gw(t=customElements){await Ne(t),await He(t),await B(t),await pe(t),await x(et,pf,t)}await Gw();function xf(){if(typeof DEV_MODE<"u")return DEV_MODE;for(let t in Xa())return!0;return!1}var Yw=function(t,e,i,o){function r(n){return n instanceof i?n:new i(function(s){s(n)})}return new(i||(i=Promise))(function(n,s){function a(u){try{d(o.next(u))}catch(p){s(p)}}function l(u){try{d(o.throw(u))}catch(p){s(p)}}function d(u){u.done?n(u.value):r(u.value).then(a,l)}d((o=o.apply(t,e||[])).next())})};function Fa(){try{let t=new CustomElementRegistry,o=document.createElement("div").attachShadow({mode:"open",customElementRegistry:t,registry:t});return o.customElementRegistry===t||o.registry===t}catch{return!1}}function _f(){return Yw(this,void 0,void 0,function*(){if(Fa())return;let t=globalThis;return t.__scopedRegistryPolyfillPromise||(t.__scopedRegistryPolyfillPromise=Promise.resolve().then(()=>Rf(wf(),1)).then(()=>{t.__scopedRegistryPolyfillApplied=!0,xf()&&console.info("[fast-af] Scoped registry polyfill loaded successfully")}).catch(e=>{t.__scopedRegistryPolyfillApplied=!1,t.__scopedRegistryPolyfillPromise=void 0;let i=new Error("[fast-af] Failed to load scoped registry polyfill");throw i.cause=e,i})),t.__scopedRegistryPolyfillPromise})}export{y as FASTElement,ye as FASTElementDefinition,Qp as applyVioletThemeRoot,_f as ensureScopedRegistrySupport,Ua as getAllSchemas,Ka as getSchema,Vn as getVioletThemePresets,h as html,Mn as installVioletTheme,Yp as installVioletThemeSet,ua as loadVioletBuiltInTheme,Fa as supportsScopedRegistries};
