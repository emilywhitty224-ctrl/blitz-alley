// vr-placer.js — reusable A-Frame components for VR building placement
// Include in any project:
//   <script src="vr-placer.js"></script>
// Or load directly from GitHub Pages (always latest):
//   <script src="https://emilywhitty224-ctrl.github.io/blitz-alley/vr-placer.js"></script>
//
// Requires: A-Frame 1.5+, aframe-extras 7.4+
// Scene must have: #rig (locomotion), #cam (camera), .placeable entities with data-name attr
// Optional globals: window.toggleNight, window.toggleVisitorMode (called by world laser buttons)

// ── DRACO GLB DECODER ────────────────────────────────────────────────────────
AFRAME.registerComponent('draco-loader', {
  init: function () {
    var dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    var gltfSystem = this.el.systems['gltf-model'];
    if (gltfSystem && gltfSystem.loader) {
      gltfSystem.loader.setDRACOLoader(dracoLoader);
    }
  }
});

// ── FIRE FLICKER ─────────────────────────────────────────────────────────────
AFRAME.registerComponent('fire-flicker', {
  schema: { min: { default: 0.6 }, max: { default: 1.6 }, chance: { default: 0.08 } },
  tick: function () {
    if (Math.random() < this.data.chance) {
      var v = this.data.min + Math.random() * (this.data.max - this.data.min);
      this.el.setAttribute('light', 'intensity', v);
    }
  }
});

// ── STAR FIELD ───────────────────────────────────────────────────────────────
AFRAME.registerComponent('star-field', {
  schema: { count: { type: 'int', default: 800 } },
  init: function () {
    var geo = new THREE.BufferGeometry();
    var pos = [];
    var n = this.data.count;
    for (var i = 0; i < n; i++) {
      var theta = Math.random() * Math.PI * 2;
      var phi   = Math.random() * Math.PI * 0.45;
      var r     = 80 + Math.random() * 30;
      pos.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) + 10,
        r * Math.sin(phi) * Math.sin(theta) - 40
      );
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xc8d8ff, size: 0.28, sizeAttenuation: true,
      transparent: true, opacity: 0.85
    });
    this.el.sceneEl.object3D.add(new THREE.Points(geo, mat));
  }
});

// No-op kept so attribute doesn't throw if still present on entities
AFRAME.registerComponent('victorian-night', { init: function () {} });

// ── DYNAMIC NIGHT TINT ───────────────────────────────────────────────────────
// Caches original material colours on load, then applies/removes night
// darkening whenever toggleNight() is called. Works on all .placeable
// buildings including newly cloned ones.
window._nightAware = [];
AFRAME.registerComponent('night-aware', {
  init: function () {
    var self = this;
    self._origColors = [];
    self._ready = false;

    function cacheColors() {
      self._origColors = [];
      self.el.object3D.traverse(function (node) {
        if (!node.isMesh) return;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(function (mat) {
          self._origColors.push({
            mat: mat,
            r: mat.color.r, g: mat.color.g, b: mat.color.b,
            er: mat.emissive ? mat.emissive.r : 0,
            eg: mat.emissive ? mat.emissive.g : 0,
            eb: mat.emissive ? mat.emissive.b : 0
          });
        });
      });
      if (self._origColors.length === 0) return;
      self._ready = true;
      if (window._nightMode) self.applyNight(true);
    }

    self.el.addEventListener('model-loaded', cacheColors);
    // Cached assets may fire model-loaded before this listener attaches
    setTimeout(function () { if (!self._ready) cacheColors(); }, 500);
    setTimeout(function () { if (!self._ready) cacheColors(); }, 2000);
    window._nightAware.push(self);
  },
  applyNight: function (on) {
    if (!this._ready) return;
    var br = 0.13, bl = 1.25;
    this._origColors.forEach(function (c) {
      if (on) {
        c.mat.color.r = c.r * br * 0.85;
        c.mat.color.g = c.g * br * 0.9;
        c.mat.color.b = c.b * br * bl;
        if (c.mat.emissive) {
          c.mat.emissive.r = c.er * 0.05;
          c.mat.emissive.g = c.eg * 0.05;
          c.mat.emissive.b = c.eb * 0.05;
        }
      } else {
        c.mat.color.r = c.r;
        c.mat.color.g = c.g;
        c.mat.color.b = c.b;
        if (c.mat.emissive) {
          c.mat.emissive.r = c.er;
          c.mat.emissive.g = c.eg;
          c.mat.emissive.b = c.eb;
        }
      }
      c.mat.needsUpdate = true;
    });
  },
  remove: function () {
    var i = window._nightAware.indexOf(this);
    if (i !== -1) window._nightAware.splice(i, 1);
  }
});
// Legacy no-op — kept so old night-tint attributes don't throw
AFRAME.registerComponent('night-tint', { init: function () {} });

// ── BOUNDARY COLLIDER ────────────────────────────────────────────────────────
// Keeps the player inside defined axis-aligned walls.
// Only active in visitor/walk mode. Set window._boundaryWalls to an array of
// { axis:'x'|'z', min, max } objects to define boundaries.
window._visitorMode = false;
window._boundaryWalls = [
  // Define walls once buildings are placed, e.g.:
  // { axis:'x', min:-2, max:2 },
  // { axis:'z', min:-30, max:0 }
];
AFRAME.registerComponent('boundary-collider', {
  init: function () {
    this._rig = null;
    var self = this;
    this.el.sceneEl.addEventListener('loaded', function () {
      self._rig = document.querySelector('#rig');
    });
  },
  tick: function () {
    if (!window._visitorMode || !this._rig) return;
    var pos = this._rig.object3D.position;
    window._boundaryWalls.forEach(function (w) {
      if (w.axis === 'x') {
        if (pos.x < w.min) pos.x = w.min;
        if (pos.x > w.max) pos.x = w.max;
      } else if (w.axis === 'z') {
        if (pos.z < w.min) pos.z = w.min;
        if (pos.z > w.max) pos.z = w.max;
      }
    });
  }
});

// ── GROUND CLAMP (raycast) ───────────────────────────────────────────────────
// Casts a 5×5 grid of rays downward through the model's footprint.
// Uses 10th-percentile Y as floor level — robust against stray low geometry.
AFRAME.registerComponent('ground-clamp', {
  init: function () {
    var el = this.el;
    el.addEventListener('model-loaded', function () {
      requestAnimationFrame(function () {
        el.object3D.position.y = 0;
        var box = new THREE.Box3().setFromObject(el.object3D);
        if (box.isEmpty()) return;
        var meshes = [];
        el.object3D.traverse(function (node) {
          if (node.isMesh) meshes.push(node);
        });
        if (meshes.length === 0) return;
        var raycaster = new THREE.Raycaster();
        var dir = new THREE.Vector3(0, -1, 0);
        var hitYs = [];
        var steps = 5;
        for (var xi = 0; xi < steps; xi++) {
          for (var zi = 0; zi < steps; zi++) {
            var x = box.min.x + (box.max.x - box.min.x) * (xi / (steps - 1));
            var z = box.min.z + (box.max.z - box.min.z) * (zi / (steps - 1));
            raycaster.set(new THREE.Vector3(x, box.max.y + 5, z), dir);
            var hits = raycaster.intersectObjects(meshes, false);
            hits.forEach(function (h) { hitYs.push(h.point.y); });
          }
        }
        var floorY;
        if (hitYs.length > 0) {
          hitYs.sort(function (a, b) { return a - b; });
          floorY = hitYs[Math.floor(hitYs.length * 0.10)];
        } else {
          floorY = box.min.y;
        }
        el.object3D.position.y = -floorY;
      });
    });
  }
});

// ── VR PLACER ────────────────────────────────────────────────────────────────
// Quest controller building placement tool.
//
// RIGHT HAND
//   Grip              : laser on + select building
//   Grip + Trigger    : move selected building (offset-locked to controller)
//   R-Stick L/R       : spin building around laser aim point
//   R-Stick U/D       : scale building around laser aim point
//   Stick click       : clone held building
//   A                 : floor snap (or snap to level in tilt mode)
//   A x2              : lock / unlock hovered building
//
// BOTH GRIPS
//   R-Stick L/R       : tilt building (rotation.z)
//   R-Stick U/D       : tilt building (rotation.x)
//   A                 : snap building to level
//
// LEFT HAND
//   Grip + L-Stick U/D : raise / lower building height
//   Stick click        : undo last move
//   X + R-Grip         : reset building to original position
//   Y                  : export positions + auto-save to localStorage
//
// WORLD BUTTONS (laser trigger at post buttons)
//   Blue post  → window.toggleNight()
//   Green post → window.toggleVisitorMode()
//   (Set window._vrPlacerBtnPts to override button positions for your scene)
AFRAME.registerComponent('vr-placer', {
  init: function () {
    var self = this;
    self.held       = null;
    self.gripping   = false;
    self.moving     = false;
    self.stickX     = 0;
    self.heightY    = 0;
    self.scaleY     = 0;
    self.raycaster      = new THREE.Raycaster();
    self.leftRaycaster  = new THREE.Raycaster();
    self.tmpQuat        = new THREE.Quaternion();
    self.groundPt       = new THREE.Vector3();
    self.laserPivot     = null;
    self.leftLaserPivot = null;
    self.hovered        = null;
    self.leftHovered    = null;
    self.leftGripping   = false;
    self.history        = [];
    self.redoHistory    = [];
    self.originals      = {};
    self.bboxCache      = {};
    self.bboxKeys       = [];
    self.frameCount     = 0;
    self.cloneCounts       = {};
    self.nightMode         = false;
    self._playerRotLock    = null;
    self._playerPosLock    = null;
    self._rigEl            = null;
    self._rightCtrlEl      = null;
    self._leftCtrlEl       = null;
    self._lockedBuildings  = {};
    self._lockPending      = null;
    self._lockPendingTimer = 0;
    self._aLastTap         = 0;
    // Pre-allocate tick vectors — never new() inside tick
    self._tickOrigin  = new THREE.Vector3();
    self._tickDir     = new THREE.Vector3();
    self._tickDist    = new THREE.Vector3();
    self._tmpBox      = new THREE.Box3();
    self._slowCtrlPos = new THREE.Vector3(); // slow-mode: current controller world pos
    self._slowLastPos = new THREE.Vector3(); // slow-mode: previous frame pos
    self._slowTracked = false;               // slow-mode: true once first valid pos captured
    self._dotVisible  = false;               // track landing dot visibility to avoid redundant setAttribute
    self._leftOrigin  = new THREE.Vector3();
    self._leftDir     = new THREE.Vector3();
    self._leftDist    = new THREE.Vector3();
    self._leftQuat    = new THREE.Quaternion();
    self._spinPivot   = new THREE.Vector3();
    self._spinOffset  = new THREE.Vector3();
    self._holdOffset  = new THREE.Vector3();
    self._btnPts      = null;
    self._btnVec      = new THREE.Vector3(); // pre-allocated for button direction check
    self._nudgeX      = false;
    self._nudgeZ      = false;
    self._tiltMode    = false;
    self._toolMode    = 0; // 0=normal 1=tilt 2=height (right stick Y)
    self._camEl       = null;
    self._locoFwd     = new THREE.Vector3();
    self._locoRight   = new THREE.Vector3();
    self._locoCQ           = new THREE.Quaternion();
    self._lastHovered = null;
    window._vrPlacerHeld = false; // used by radial-menu to block wheel when building is held

    // ── Hover glow helper — subtle cyan emissive boost, restores on exit ─
    self._setHoverGlow = function (el, on) {
      if (!el || !el.object3D) return;
      el.object3D.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (mat) {
          if (on) {
            if (!mat._hoverOrigEmissive) {
              mat._hoverOrigEmissive = mat.emissive
                ? mat.emissive.clone() : new THREE.Color(0, 0, 0);
              mat._hoverOrigEmissiveIntensity = mat.emissiveIntensity != null
                ? mat.emissiveIntensity : 0;
            }
            mat.emissive.set(0.05, 0.25, 0.35);  // subtle cyan, won't wash out the model
            mat.emissiveIntensity = 0.45;
          } else {
            if (mat._hoverOrigEmissive) {
              mat.emissive.copy(mat._hoverOrigEmissive);
              mat.emissiveIntensity = mat._hoverOrigEmissiveIntensity;
              delete mat._hoverOrigEmissive;
              delete mat._hoverOrigEmissiveIntensity;
            }
          }
        });
      });
    };

    // ── Haptic helper ─────────────────────────────────────────────────────
    self._haptic = function (ctrlEl, intensity, duration) {
      try {
        var tc = ctrlEl && (ctrlEl.components['tracked-controls-webxr'] ||
                            ctrlEl.components['tracked-controls']);
        var gp = tc && tc.controller && tc.controller.gamepad;
        if (gp && gp.hapticActuators && gp.hapticActuators.length > 0) {
          var _p = gp.hapticActuators[0].pulse(intensity, duration);
          if (_p && _p.catch) _p.catch(function () {}); // prevent unhandled rejection killing WebXR session
        }
      } catch (e) {}
    };

    this.el.sceneEl.addEventListener('loaded', function () {
      var cam       = document.querySelector('#cam');
      var rigEl     = document.querySelector('#rig');
      self._rigEl   = rigEl;
      self._camEl   = cam;
      var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
      var leftCtrl  = document.querySelector('[oculus-touch-controls*="left"]');
      self._rightCtrlEl = rightCtrl;
      self._leftCtrlEl  = leftCtrl;

      // World-space clickable buttons — scene can override via window._vrPlacerBtnPts
      self._btnPts = window._vrPlacerBtnPts || [
        { pos: new THREE.Vector3(1.0,  1.55, -33.5), fn: function () { if (window.toggleNight) window.toggleNight(); } },
        { pos: new THREE.Vector3(2.6,  1.55, -33.5), fn: function () { if (window.toggleVisitorMode) window.toggleVisitorMode(); } }
      ];
      self._btnRay = new THREE.Ray();

      // ── Store originals + build bbox cache after models settle ──────────
      function rebuildBbox(el) {
        var id  = el.getAttribute('data-name');
        var box = new THREE.Box3().setFromObject(el.object3D);
        self.bboxCache[id] = { el: el, box: box, lastPos: el.object3D.position.clone() };
        self.bboxKeys = Object.keys(self.bboxCache);
      }
      document.querySelectorAll('.placeable').forEach(function (el) {
        el.addEventListener('model-loaded', function () {
          requestAnimationFrame(function () { rebuildBbox(el); });
        });
      });
      requestAnimationFrame(function () {
        document.querySelectorAll('.placeable').forEach(function (el) {
          var id = el.getAttribute('data-name');
          var p  = el.object3D.position;
          self.originals[id] = {
            x: p.x, y: p.y, z: p.z,
            rotY: el.object3D.rotation.y,
            scale: el.object3D.scale.x
          };
          rebuildBbox(el);
        });
        window._placerOriginals = self.originals;
      });

      // ── Right laser pivot — tilted 45° down ─────────────────────────────
      var laserPivot = document.createElement('a-entity');
      laserPivot.setAttribute('rotation', '-45 0 0');
      laserPivot.setAttribute('visible', 'true'); // always on — dims when idle
      var laser = document.createElement('a-box');
      laser.setAttribute('width',  '0.004');
      laser.setAttribute('height', '0.004');
      laser.setAttribute('depth',  '20');
      laser.setAttribute('position', '0 0 -10');
      laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.18; transparent:true');
      laserPivot.appendChild(laser);
      if (rightCtrl) rightCtrl.appendChild(laserPivot);
      self.laser      = laser;
      self.laserPivot = laserPivot;

      // ── Landing dot — glowing ring on the floor showing laser endpoint ──
      var landingDot = document.createElement('a-ring');
      landingDot.setAttribute('radius-inner', '0.12');
      landingDot.setAttribute('radius-outer', '0.18');
      landingDot.setAttribute('rotation', '-90 0 0');
      landingDot.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.8; transparent:true');
      landingDot.setAttribute('visible', 'false');
      self.el.sceneEl.appendChild(landingDot);
      self._landingDot = landingDot;

      // ── Left laser pivot — orange, for height control ────────────────────
      var leftLaserPivot = document.createElement('a-entity');
      leftLaserPivot.setAttribute('rotation', '-45 0 0');
      leftLaserPivot.setAttribute('visible', 'false');
      var leftLaser = document.createElement('a-box');
      leftLaser.setAttribute('width',  '0.005');
      leftLaser.setAttribute('height', '0.005');
      leftLaser.setAttribute('depth',  '20');
      leftLaser.setAttribute('position', '0 0 -10');
      leftLaser.setAttribute('material', 'color:#ff8800; emissive:#ff6600; emissiveIntensity:1; shader:flat; opacity:0.7; transparent:true');
      leftLaserPivot.appendChild(leftLaser);
      if (leftCtrl) leftCtrl.appendChild(leftLaserPivot);
      self.leftLaserPivot = leftLaserPivot;

      // ── Output HUD ───────────────────────────────────────────────────────
      var outPanel = document.createElement('a-plane');
      outPanel.setAttribute('position', '0 0.08 -0.6');
      outPanel.setAttribute('width',  '1.1');
      outPanel.setAttribute('height', '0.72');
      outPanel.setAttribute('material', 'color:#000811; opacity:0.92; transparent:true; shader:flat');
      outPanel.setAttribute('visible', 'false');
      cam.appendChild(outPanel);

      var outText = document.createElement('a-entity');
      outText.setAttribute('position', '-0.52 0.42 -0.59');
      outText.setAttribute('text', 'value: ; color:#44ffaa; align:left; width:1.1; wrapCount:52');
      outText.setAttribute('visible', 'false');
      cam.appendChild(outText);

      // ── Live readout ─────────────────────────────────────────────────────
      var readout = document.createElement('a-entity');
      readout.setAttribute('position', '0 -0.18 -0.55');
      readout.setAttribute('text', 'value: ; color:#ffdd44; align:center; width:1.4');
      readout.setAttribute('visible', 'false');
      cam.appendChild(readout);
      self.readout = readout;
      self.readoutTimer = -1;
      self.outPanel = outPanel;
      self.outText  = outText;

      // ── Right controller ─────────────────────────────────────────────────
      if (rightCtrl) {
        rightCtrl.addEventListener('gripdown', function () {
          try {
            self.gripping = true;
            // Brighten laser on grip
            if (self.laser) self.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.65; transparent:true');
            if (rigEl) {
              self._playerRotLock = rigEl.object3D.rotation.y;
              self._playerPosLock = { x: rigEl.object3D.position.x, z: rigEl.object3D.position.z };
            }
            if (self.hovered) {
              self.history.push({
                el:    self.hovered,
                x:     self.hovered.object3D.position.x,
                z:     self.hovered.object3D.position.z,
                rotY:  self.hovered.object3D.rotation.y,
                scale: self.hovered.object3D.scale.x
              });
              self.redoHistory = [];
              self._lastHovered = null;
              self.held = self.hovered;
              window._vrPlacerHeld = true;
              self._haptic(rightCtrl, 0.6, 100);
              self._spinPivot.set(self.held.object3D.position.x, 0, self.held.object3D.position.z);
              self._spinOffset.set(0, 0, 0);
              self.moving = true;
              self._slowTracked = false;
            }
          } catch (e) { console.error('gripdown error:', e); }
        });

        rightCtrl.addEventListener('gripup', function () {
          var justReleased = self.held;
          self.gripping  = false;
          self.moving    = false;
          self.held      = null;
          self.hovered   = null;
          self.stickX    = 0;
          self.heightY   = 0;
          self.scaleY    = 0;
          // _toolMode intentionally NOT reset — stays active until changed in panel
          // Dim laser back to idle (don't hide — always on)
          if (self.laser) self.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.18; transparent:true');
          if (self._landingDot && self._dotVisible) { self._landingDot.setAttribute('visible', 'false'); self._dotVisible = false; }
          self._playerRotLock = null;
          self._playerPosLock = null;
          self._slowTracked = false; // clear slow-mode delta tracking
          window._vrPlacerHeld = false;
          if (justReleased) {
            // Grid snap — round X and Z to nearest 0.5 m
            if (window._gridSnap) {
              justReleased.object3D.position.x = Math.round(justReleased.object3D.position.x / 0.5) * 0.5;
              justReleased.object3D.position.z = Math.round(justReleased.object3D.position.z / 0.5) * 0.5;
            }
            self._haptic(rightCtrl, 0.2, 50); // soft release buzz
            requestAnimationFrame(function () {
              var id  = justReleased.getAttribute('data-name');
              var box = new THREE.Box3().setFromObject(justReleased.object3D);
              self.bboxCache[id] = { el: justReleased, box: box, lastPos: justReleased.object3D.position.clone() };
              self.bboxKeys = Object.keys(self.bboxCache);
            });
          }
          // Auto-save layout
          try {
            var layout = {};
            document.querySelectorAll('.placeable').forEach(function (el) {
              var id = el.getAttribute('data-name');
              var p  = el.object3D.position;
              layout[id] = { x: p.x, y: p.y, z: p.z, rotY: el.object3D.rotation.y, scale: el.object3D.scale.x };
            });
            localStorage.setItem('blitz-layout', JSON.stringify(layout));
          } catch(e) {}
        });

        rightCtrl.addEventListener('triggerdown', function () {
          if (self.gripping && self.held) {
            self.moving = true; // trigger re-enables dragging if it was paused
          }
          if (self._btnPts) {
            // Button ray: controller forward direction (NOT the 45°-down laser)
            rightCtrl.object3D.getWorldPosition(self._tickOrigin);
            rightCtrl.object3D.getWorldQuaternion(self.tmpQuat);
            self._tickDir.set(0, 0, -1).applyQuaternion(self.tmpQuat).normalize();
            for (var bi = 0; bi < self._btnPts.length; bi++) {
              if (!self._btnPts[bi] || !self._btnPts[bi].pos) continue;
              self._btnVec.subVectors(self._btnPts[bi].pos, self._tickOrigin).normalize();
              if (self._btnVec.dot(self._tickDir) > 0.92) { // ~23° cone — generous for world buttons
                self._btnPts[bi].fn();
                break;
              }
            }
          }
        });
        rightCtrl.addEventListener('triggerup', function () {
          // Moving continues from grip — trigger release has no effect on held building
        });

        rightCtrl.addEventListener('thumbstickmoved', function (e) {
          self.stickX = e.detail.x;
          self.scaleY = e.detail.y;
        });

        // A button — floor snap, or snap to level in tilt mode
        rightCtrl.addEventListener('abuttondown', function () {
          // Help panel takes highest priority — A closes it
          if (window._helpPanelIsOpen) {
            if (window._closeHelpPanel) window._closeHelpPanel();
            return;
          }
          // Control panel takes priority when open
          if (window._controlPanelOpen) {
            if (window._cpActivate) window._cpActivate();
            return;
          }
          if (self.held) {
            if (self._tiltMode) {
              self.held.object3D.rotation.x = 0;
              self.held.object3D.rotation.z = 0;
            } else {
              self.held.object3D.position.y = 0;
            }
            return;
          }
          // No building held — double-tap A to lock/unlock hovered building
          var now    = Date.now();
          var target = self.hovered || self._lockPending;
          if (!target) return;
          var id = target.getAttribute('data-name');
          if (self._lockPending && self._lockPending === target && (now - self._aLastTap) < 2000) {
            var wasLocked = self._lockedBuildings[id];
            if (wasLocked) {
              delete self._lockedBuildings[id];
              target.object3D.traverse(function(o) {
                if (o.isMesh && o.material) { o.material.opacity = 1; o.material.transparent = false; }
              });
              if (self.outText) self.outText.setAttribute('text', 'value', id + ': UNLOCKED');
            } else {
              self._lockedBuildings[id] = true;
              target.object3D.traverse(function(o) {
                if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 0.5; }
              });
              if (self.outText) self.outText.setAttribute('text', 'value', id + ': LOCKED');
            }
            self._lockPending = null;
            self._lockPendingTimer = 120;
          } else {
            self._lockPending = target;
            self._lockPendingTimer = 180;
            var isLocked = self._lockedBuildings[id];
            if (self.outText) self.outText.setAttribute('text', 'value',
              (isLocked ? 'UNLOCK ' : 'LOCK ') + id + '?\nTap A again to confirm');
          }
          self._aLastTap = now;
        });

        // Right stick click — reset held building scale + rotation to original spawn values
        rightCtrl.addEventListener('thumbstickdown', function () {
          if (self.held) {
            var id0  = self.held.getAttribute('data-name');
            var orig = self.originals[id0];
            if (orig) {
              self.held.object3D.scale.setScalar(orig.scale);
              self.held.object3D.rotation.set(0, orig.rotY, 0);
            } else {
              // No original recorded — just level it
              self.held.object3D.rotation.x = 0;
              self.held.object3D.rotation.z = 0;
            }
            self._haptic(rightCtrl, 0.35, 60);
            if (self.readout) {
              self.readout.setAttribute('text', 'value', 'reset ↺');
              self.readout.setAttribute('visible', 'true');
              self.readoutTimer = 90;
            }
          } else {
            cloneHeld();
          }
        });
      }

      // ── Left controller ──────────────────────────────────────────────────
      if (leftCtrl) {
        leftCtrl.addEventListener('thumbstickmoved', function (e) {
          self.heightY = e.detail.y;
        });

        leftCtrl.addEventListener('thumbstickdown', function () {
          if (window._radialMenuOpen) return;
          self.doUndo();
        });

        leftCtrl.addEventListener('gripdown', function () {
          self.leftGripping = true;
          self.leftLaserPivot.setAttribute('visible', 'true');
          if (rigEl && !self._playerPosLock) {
            self._playerPosLock = { x: rigEl.object3D.position.x, z: rigEl.object3D.position.z };
          }
        });
        leftCtrl.addEventListener('gripup', function () {
          self.leftGripping = false;
          self.leftHovered  = null;
          self.leftLaserPivot.setAttribute('visible', 'false');
          if (!self.gripping) self._playerPosLock = null;
        });

        // X — delete hovered or held building (removes from scene + all caches)
        leftCtrl.addEventListener('xbuttondown', function () {
          var target = self.held || self.hovered;
          if (!target) return;
          var delId = target.getAttribute('data-name');
          // Release grip state if we're holding it
          if (self.held === target) {
            self.held     = null;
            self.gripping = false;
            self.moving   = false;
            window._vrPlacerHeld = false;
            laserPivot.setAttribute('visible', 'false');
            self._playerRotLock = null;
            self._playerPosLock = null;
          }
          self.hovered = null;
          // Remove from bboxCache, originals, history
          delete self.bboxCache[delId];
          delete self.originals[delId];
          self.bboxKeys = Object.keys(self.bboxCache);
          self.history     = self.history.filter(function (h) { return h.el !== target; });
          self.redoHistory = self.redoHistory.filter(function (h) { return h.el !== target; });
          // Remove from DOM
          if (target.parentNode) target.parentNode.removeChild(target);
          self._haptic(rightCtrl, 0.5, 80);
          if (self.readout) {
            self.readout.setAttribute('text', 'value', 'deleted  ' + delId);
            self.readout.setAttribute('visible', 'true');
            self.readoutTimer = 90;
          }
        });

        // Y button — export positions + copy to clipboard
        leftCtrl.addEventListener('ybuttondown', function () {
          var vis = outPanel.getAttribute('visible');
          if (vis === 'true' || vis === true) {
            outPanel.setAttribute('visible', 'false');
            outText.setAttribute('visible',  'false');
            return;
          }
          var lines = '── PASTE INTO HTML ──\n';
          document.querySelectorAll('.placeable').forEach(function (el) {
            var p  = el.object3D.position;
            var sc = el.object3D.scale.x.toFixed(3);
            var ry = Math.round(THREE.MathUtils.radToDeg(el.object3D.rotation.y));
            var id = el.getAttribute('data-name') || '?';
            lines += id + '\n';
            lines += 'pos="' + p.x.toFixed(2) + ' 0 ' + p.z.toFixed(2) + '"\n';
            lines += 'rot="0 ' + ry + ' 0"\n';
            lines += 'scale="' + sc + ' ' + sc + ' ' + sc + '"\n\n';
          });
          outText.setAttribute('text', 'value', lines);
          outPanel.setAttribute('visible', 'true');
          outText.setAttribute('visible',  'true');
          if (navigator.clipboard) navigator.clipboard.writeText(lines).catch(function(){});
          // Haptic + HUD toast
          self._haptic(leftCtrl, 0.5, 150);
          if (self.readout) {
            self.readout.setAttribute('text', 'value', 'Layout Copied ✓');
            self.readout.setAttribute('visible', 'true');
            self.readoutTimer = 200;
          }
          try {
            var layout = {};
            document.querySelectorAll('.placeable').forEach(function (el) {
              var id2 = el.getAttribute('data-name');
              var p2  = el.object3D.position;
              layout[id2] = { x: p2.x, y: p2.y, z: p2.z, rotY: el.object3D.rotation.y, scale: el.object3D.scale.x };
            });
            localStorage.setItem('blitz-layout', JSON.stringify(layout));
          } catch (e) {}
        });
      }

      // ── Exposed methods (called by control-panel component) ─────────────
      self.doUndo = function () {
        if (self.history.length === 0) return 'nothing to undo';
        var last = self.history.pop();
        // Save current state to redo stack
        self.redoHistory.push({
          el: last.el,
          x: last.el.object3D.position.x,
          z: last.el.object3D.position.z,
          rotY: last.el.object3D.rotation.y,
          scale: last.el.object3D.scale.x
        });
        last.el.object3D.position.x = last.x;
        last.el.object3D.position.z = last.z;
        last.el.object3D.rotation.y = last.rotY;
        last.el.object3D.scale.setScalar(last.scale);
        return 'UNDO';
      };

      self.doRedo = function () {
        if (self.redoHistory.length === 0) return 'nothing to redo';
        var last = self.redoHistory.pop();
        self.history.push({
          el: last.el,
          x: last.el.object3D.position.x,
          z: last.el.object3D.position.z,
          rotY: last.el.object3D.rotation.y,
          scale: last.el.object3D.scale.x
        });
        last.el.object3D.position.x = last.x;
        last.el.object3D.position.z = last.z;
        last.el.object3D.rotation.y = last.rotY;
        last.el.object3D.scale.setScalar(last.scale);
        return 'REDO';
      };

      self.doFloorSnap = function () {
        var target = self.held || self.hovered;
        if (!target) return 'no building selected';
        if (self._tiltMode) {
          target.object3D.rotation.x = 0;
          target.object3D.rotation.z = 0;
          return 'snapped to level';
        }
        target.object3D.position.y = 0;
        return 'snapped to floor';
      };

      self.doClone = function () {
        if (!self.held) return 'hold a building first';
        var srcName = self.held.getAttribute('data-name');
        self.cloneCounts[srcName] = (self.cloneCounts[srcName] || 0) + 1;
        var newName = srcName + '-' + self.cloneCounts[srcName];
        var clone   = document.createElement('a-entity');
        clone.setAttribute('class', 'placeable');
        clone.setAttribute('night-aware', '');
        clone.setAttribute('data-name', newName);
        clone.setAttribute('gltf-model', self.held.getAttribute('gltf-model'));
        var p  = self.held.object3D.position;
        var sc = self.held.object3D.scale.x;
        clone.setAttribute('position', (p.x + 4) + ' ' + p.y + ' ' + p.z);
        clone.setAttribute('scale', sc + ' ' + sc + ' ' + sc);
        clone.addEventListener('model-loaded', function () {
          requestAnimationFrame(function () { rebuildBbox(clone); });
        });
        decoratePlaceable(clone);
        self.el.sceneEl.appendChild(clone);
        self.history.push({ el: clone, x: p.x + 4, y: p.y, z: p.z, rotY: 0, scale: sc });
        self.redoHistory = [];
        self.held = clone;
        return 'cloned ' + srcName;
      };

      self.doSave = function () {
        try {
          var layout = {};
          document.querySelectorAll('.placeable').forEach(function (el) {
            var id3 = el.getAttribute('data-name');
            var p3  = el.object3D.position;
            layout[id3] = { x: p3.x, y: p3.y, z: p3.z, rotY: el.object3D.rotation.y, scale: el.object3D.scale.x };
          });
          localStorage.setItem('blitz-layout', JSON.stringify(layout));
        } catch (e) {}
        return 'layout saved';
      };

      self.doLockToggle = function () {
        var target = self.held || self.hovered;
        if (!target) return 'no building selected';
        var id = target.getAttribute('data-name');
        if (self._lockedBuildings[id]) {
          delete self._lockedBuildings[id];
          target.object3D.traverse(function (o) {
            if (o.isMesh && o.material) { o.material.opacity = 1; o.material.transparent = false; }
          });
          return id + ': UNLOCKED';
        } else {
          self._lockedBuildings[id] = true;
          target.object3D.traverse(function (o) {
            if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 0.5; }
          });
          return id + ': LOCKED';
        }
      };

      // ── Helpers ──────────────────────────────────────────────────────────
      function decoratePlaceable(el) {
        var name = el.getAttribute('data-name') || '';
        if (!name) return;
        var lbl = document.createElement('a-text');
        lbl.setAttribute('value', name);
        lbl.setAttribute('position', '0 3 0');
        lbl.setAttribute('align', 'center');
        lbl.setAttribute('color', '#ffee88');
        lbl.setAttribute('width', '12');
        lbl.setAttribute('material', 'shader:flat');
        el.appendChild(lbl);
      }

      function cloneHeld() { self.doClone(); }

      document.querySelectorAll('.placeable').forEach(function (el) {
        decoratePlaceable(el);
      });

      // ── Load saved layout from localStorage ──────────────────────────────
      try {
        var saved = JSON.parse(localStorage.getItem('blitz-layout'));
        if (saved) {
          document.querySelectorAll('.placeable').forEach(function (el) {
            var id = el.getAttribute('data-name');
            var d  = saved[id];
            if (!d) return;
            el.addEventListener('model-loaded', function () {
              requestAnimationFrame(function () {
                el.object3D.position.set(d.x, d.y || 0, d.z);
                el.object3D.rotation.y = d.rotY || 0;
                el.object3D.scale.setScalar(d.scale);
              });
            }, { once: true });
          });
        }
      } catch (e) {}

    });
  },

  tick: function () {
    if (!this.laserPivot) return;
    this.frameCount++;

    // Safety: un-stick grip state if the grip button is no longer physically held
    if (this.gripping && this._rightCtrlEl) {
      var _tc = this._rightCtrlEl.components['tracked-controls-webxr'] ||
                this._rightCtrlEl.components['tracked-controls'];
      var _gp = _tc && _tc.controller && _tc.controller.gamepad;
      if (_gp && _gp.buttons[1] && !_gp.buttons[1].pressed) {
        this.gripping = false;
        this.moving   = false;
        this.held     = null;
        this._playerRotLock = null;
        this._playerPosLock = null;
        if (this.laser) this.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.18; transparent:true');
        if (this._landingDot && this._dotVisible) { this._landingDot.setAttribute('visible', 'false'); this._dotVisible = false; }
        window._vrPlacerHeld = false;
      }
    }

    // Lock rig rotation + position every frame while gripping
    if (this._rigEl && this._playerRotLock !== null) {
      this._rigEl.object3D.rotation.y = this._playerRotLock;
    }
    if (this._rigEl && this._playerPosLock !== null) {
      this._rigEl.object3D.position.x = this._playerPosLock.x;
      this._rigEl.object3D.position.z = this._playerPosLock.z;
    }

    // In visitor mode: dim laser to invisible, clear any hover/hold
    if (window._visitorMode) {
      if (this.laser) this.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0; transparent:true');
      if (this._landingDot && this._dotVisible) { this._landingDot.setAttribute('visible', 'false'); this._dotVisible = false; }
      if (this._lastHovered) {
        if (this.laser) this.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.6; transparent:true');
        this._lastHovered = null;
      }
      this.hovered  = null;
      this.held     = null;
      this.gripping = false;
      this.moving   = false;
      window._vrPlacerHeld = false;
    }

    // Rolling bbox refresh — 1 building per frame to keep hover accurate
    // Runs inside try/catch (setFromObject can throw on malformed GLB geometry)
    if (!this.gripping && this.bboxKeys.length > 0) {
      try {
        var rbIdx   = this.frameCount % this.bboxKeys.length;
        var rbKey   = this.bboxKeys[rbIdx];
        var rbEntry = this.bboxCache[rbKey];
        if (rbEntry && rbEntry.el) {
          this._tmpBox.setFromObject(rbEntry.el.object3D); // reuse pre-allocated box
          rbEntry.box.copy(this._tmpBox);
          rbEntry.lastPos.copy(rbEntry.el.object3D.position);
        }
      } catch (e) {}
    }

    // Lock pending countdown
    if (this._lockPendingTimer > 0) {
      this._lockPendingTimer--;
      if (this._lockPendingTimer === 0) {
        this._lockPending = null;
        if (this.outText) this.outText.setAttribute('text', 'value', '');
      }
    }

    try {

    // ── Hover: bbox check every 12 frames ────────────────────────────────
    if (this.frameCount % 12 === 0) {
      this.laserPivot.object3D.getWorldPosition(this._tickOrigin);
      this.laserPivot.object3D.getWorldQuaternion(this.tmpQuat);
      this._tickDir.set(0, 0, -1).applyQuaternion(this.tmpQuat).normalize();
      this.raycaster.set(this._tickOrigin, this._tickDir);

      var newHovered = null;
      var bestDist   = Infinity;
      var keys       = this.bboxKeys;
      var cache      = this.bboxCache;
      var origin     = this._tickOrigin;
      var dist       = this._tickDist;
      var tmpBox     = this._tmpBox;
      for (var i = 0; i < keys.length; i++) {
        var entry = cache[keys[i]];
        if (!entry || !entry.el) continue;
        if (this._lockedBuildings[keys[i]]) continue;
        var cur   = entry.el.object3D.position;
        var last  = entry.lastPos;
        tmpBox.copy(entry.box);
        tmpBox.min.x += cur.x - last.x; tmpBox.min.z += cur.z - last.z;
        tmpBox.max.x += cur.x - last.x; tmpBox.max.z += cur.z - last.z;
        if (this.raycaster.ray.intersectBox(tmpBox, dist) !== null) {
          var d = origin.distanceTo(dist);
          if (d < bestDist) { bestDist = d; newHovered = entry.el; }
        }
      }
      this.hovered = newHovered;

      // Auto-grab: grip is held but nothing in hand yet — snap to first building laser touches
      if (this.gripping && !this.held && this.hovered) {
        var _agId = this.hovered.getAttribute('data-name');
        if (!this._lockedBuildings[_agId]) {
          this.history.push({
            el:    this.hovered,
            x:     this.hovered.object3D.position.x,
            z:     this.hovered.object3D.position.z,
            rotY:  this.hovered.object3D.rotation.y,
            scale: this.hovered.object3D.scale.x
          });
          this.redoHistory = [];
          this._lastHovered = null;
          if (this.laser) this.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.6; transparent:true');
          this.held = this.hovered;
          this._haptic(this._rightCtrlEl, 0.6, 100);
          this._spinPivot.set(this.held.object3D.position.x, 0, this.held.object3D.position.z);
          this._spinOffset.set(0, 0, 0);
          this.moving = true;
          this._slowTracked = false; // reset slow-mode delta tracking
          this.laserPivot.object3D.getWorldPosition(this._tickOrigin);
          this._holdOffset.set(
            this.held.object3D.position.x - this._tickOrigin.x,
            0,
            this.held.object3D.position.z - this._tickOrigin.z
          );
        }
      }

      // Laser turns orange when locked onto a building, cyan when free
      if (this.hovered !== this._lastHovered) {
        if (this.laser) {
          if (this.hovered) {
            this.laser.setAttribute('material', 'color:#ff8800; emissive:#ff8800; emissiveIntensity:1; shader:flat; opacity:0.85; transparent:true');
          } else {
            this.laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.6; transparent:true');
          }
        }
        this._lastHovered = this.hovered;
      }
    }

    if (!this.held) {
      // Hide landing dot when nothing held
      if (this._landingDot && this._dotVisible) { this._landingDot.setAttribute('visible', 'false'); this._dotVisible = false; }
    } else {

    // ── Move ──────────────────────────────────────────────────────────────
    if (this.moving) {
      if (window._slowMoveMode) {
        // SLOW mode: 1:1 hand-to-building movement (no laser projection)
        if (this._rightCtrlEl) {
          this._rightCtrlEl.object3D.getWorldPosition(this._slowCtrlPos);
          // Guard: skip if controller not yet tracked (position at origin)
          var _mag = this._slowCtrlPos.x * this._slowCtrlPos.x +
                     this._slowCtrlPos.z * this._slowCtrlPos.z;
          if (_mag > 0.001) {
            if (this._slowTracked) {
              this.held.object3D.position.x += this._slowCtrlPos.x - this._slowLastPos.x;
              this.held.object3D.position.z += this._slowCtrlPos.z - this._slowLastPos.z;
            }
            this._slowLastPos.copy(this._slowCtrlPos);
            this._slowTracked = true;
          }
        }
        // Landing dot at building's feet
        if (this._landingDot) {
          this._landingDot.object3D.position.set(
            this.held.object3D.position.x,
            this.held.object3D.position.y + 0.02,
            this.held.object3D.position.z);
          if (!this._dotVisible) { this._landingDot.setAttribute('visible', 'true'); this._dotVisible = true; }
        }
      } else {
        // Laser → floor intersection: aim laser at floor, building follows hit point
        this.laserPivot.object3D.getWorldPosition(this._tickOrigin);
        this.laserPivot.object3D.getWorldQuaternion(this.tmpQuat);
        this._tickDir.set(0, 0, -1).applyQuaternion(this.tmpQuat).normalize();
        var planeY = this.held.object3D.position.y;
        if (this._tickDir.y < -0.02) {
          var _t = (planeY - this._tickOrigin.y) / this._tickDir.y;
          if (_t > 0.15 && _t < 28) {
            var _nx = this._tickOrigin.x + this._tickDir.x * _t;
            var _nz = this._tickOrigin.z + this._tickDir.z * _t;
            this.held.object3D.position.x = _nx;
            this.held.object3D.position.z = _nz;
            if (this._landingDot) {
              this._landingDot.object3D.position.set(_nx, planeY + 0.02, _nz);
              if (!this._dotVisible) { this._landingDot.setAttribute('visible', 'true'); this._dotVisible = true; }
            }
          }
        }
      }
    }

    // ── Poll gamepads directly — events miss held positions ───────────────
    if (this.gripping && this._rightCtrlEl) {
      var tc = this._rightCtrlEl.components['tracked-controls-webxr'] ||
               this._rightCtrlEl.components['tracked-controls'];
      var gp = tc && tc.controller && tc.controller.gamepad;
      if (gp && gp.axes.length >= 4) {
        this.stickX = gp.axes[2];
        this.scaleY = gp.axes[3];
      }
    }
    // Poll left gamepad for nudge
    var leftNudgeX = 0, leftNudgeZ = 0;
    if (this.gripping && this._leftCtrlEl) {
      var ltc = this._leftCtrlEl.components['tracked-controls-webxr'] ||
                this._leftCtrlEl.components['tracked-controls'];
      var lgp = ltc && ltc.controller && ltc.controller.gamepad;
      if (lgp && lgp.axes.length >= 4) {
        leftNudgeX = lgp.axes[2];
        leftNudgeZ = lgp.axes[3];
      }
    }

    // ── Stick modes ──────────────────────────────────────────────────────────
    // Normal:               right stick X = rotate, Y = scale
    // Left trigger (shift): right stick X/Y = tilt (lean X/Z)
    // Left grip (vertical): left stick Y = raise/lower held building
    // Panel TILT/HEIGHT buttons still work as overrides if needed
    this._tiltMode = (this._toolMode === 1) || window._leftTriggerShift;

    var adjusting = false;

    if (window._leftTriggerShift || this._toolMode === 1) {
      // ── TILT (left trigger shift OR panel TILT button) ───────────────────
      if (Math.abs(this.stickX) > 0.15)
        this.held.object3D.rotation.z += this.stickX * 0.018;
      if (Math.abs(this.scaleY) > 0.15)
        this.held.object3D.rotation.x += this.scaleY * 0.018;
      if (this.readout && this.frameCount % 6 === 0) {
        var rx = THREE.MathUtils.radToDeg(this.held.object3D.rotation.x);
        var rz = THREE.MathUtils.radToDeg(this.held.object3D.rotation.z);
        var isLevel = Math.abs(rx) < 1.5 && Math.abs(rz) < 1.5;
        this.readout.setAttribute('text', 'value',
          (isLevel ? 'LEVEL ✓' : 'tilt  X:' + rx.toFixed(1) + '°  Z:' + rz.toFixed(1) + '°'));
        this.readout.setAttribute('visible', 'true');
        this.readoutTimer = 6;
      }
    } else if (this._toolMode === 2) {
      // ── HEIGHT (panel HEIGHT button — legacy) ────────────────────────────
      if (Math.abs(this.scaleY) > 0.15) {
        this.held.object3D.position.y -= this.scaleY * 0.007;
        if (this.readout && this.frameCount % 6 === 0) {
          var hy  = this.held.object3D.position.y.toFixed(2);
          var hlb = parseFloat(hy) >= 0 ? '+' + hy : hy;
          this.readout.setAttribute('text', 'value', 'height  ' + hlb + ' m');
          this.readout.setAttribute('visible', 'true');
          this.readoutTimer = 60;
        }
      }
      if (Math.abs(this.stickX) > 0.15)
        this.held.object3D.rotation.y += this.stickX * 0.02;
    } else {
      // ── NORMAL — rotate + scale ──────────────────────────────────────────
      if (Math.abs(this.stickX) > 0.15) {
        this.held.object3D.rotation.y += this.stickX * 0.02;
        this._spinPivot.set(this.held.object3D.position.x, 0, this.held.object3D.position.z);
      }
      if (Math.abs(this.scaleY) > 0.15) {
        var oldSc = this.held.object3D.scale.x;
        var ns    = Math.max(0.02, oldSc + this.scaleY * 0.002);
        this.held.object3D.scale.setScalar(ns);
        adjusting = true;
      }
    }

    // ── Nudge — left stick, only when not left-gripping
    if (!this.leftGripping) {
      var NUDGE = 0.1;
      var nxOn = Math.abs(leftNudgeX) > 0.5;
      var nzOn = Math.abs(leftNudgeZ) > 0.5;
      if (nxOn && !this._nudgeX) this.held.object3D.position.x += (leftNudgeX > 0 ? NUDGE : -NUDGE);
      if (nzOn && !this._nudgeZ) this.held.object3D.position.z += (leftNudgeZ > 0 ? NUDGE : -NUDGE);
      this._nudgeX = nxOn;
      this._nudgeZ = nzOn;
    } else {
      this._nudgeX = false;
      this._nudgeZ = false;
    }

    adjusting = this._tiltMode ? false : adjusting;

    // ── Live scale readout ────────────────────────────────────────────────
    if (this.readout && adjusting) {
      this.readoutTimer = 90;
      if (this.frameCount % 6 === 0) {
        this.readout.setAttribute('text', 'value', 'scale  ' + this.held.object3D.scale.x.toFixed(3));
        this.readout.setAttribute('visible', 'true');
      }
    }

    } // end if (this.held)

    // ── Readout timer — hides display when it expires (runs always) ───────────
    if (this.readout && this.readoutTimer >= 0) {
      if (this.readoutTimer > 0) {
        this.readoutTimer--;
      } else {
        this.readout.setAttribute('visible', 'false');
        this.readoutTimer = -1;
      }
    }

    // ── Left laser hover + height control ────────────────────────────────
    if (this.leftLaserPivot && this.leftGripping && this.frameCount % 12 === 0) {
      this.leftLaserPivot.object3D.getWorldPosition(this._leftOrigin);
      this.leftLaserPivot.object3D.getWorldQuaternion(this._leftQuat);
      this._leftDir.set(0, 0, -1).applyQuaternion(this._leftQuat).normalize();
      this.leftRaycaster.set(this._leftOrigin, this._leftDir);

      var leftBest = Infinity;
      var leftNew  = null;
      var lkeys    = this.bboxKeys;
      var lcache   = this.bboxCache;
      var lbox     = this._tmpBox;
      for (var li = 0; li < lkeys.length; li++) {
        var lentry = lcache[lkeys[li]];
        if (!lentry || !lentry.el) continue;
        var lcur  = lentry.el.object3D.position;
        var llast = lentry.lastPos;
        lbox.copy(lentry.box);
        lbox.min.x += lcur.x - llast.x; lbox.min.z += lcur.z - llast.z;
        lbox.max.x += lcur.x - llast.x; lbox.max.z += lcur.z - llast.z;
        if (this.leftRaycaster.ray.intersectBox(lbox, this._leftDist) !== null) {
          var ld = this._leftOrigin.distanceTo(this._leftDist);
          if (ld < leftBest) { leftBest = ld; leftNew = lentry.el; }
        }
      }
      this.leftHovered = leftNew;
    }

    // Left grip = vertical mode: adjusts held building first, falls back to left-laser-hovered
    var _heightTarget = this.held || this.leftHovered;
    if (this.leftGripping && _heightTarget && Math.abs(this.heightY) > 0.15) {
      _heightTarget.object3D.position.y -= this.heightY * 0.007;
      if (this.readout && this.frameCount % 6 === 0) {
        var hy  = _heightTarget.object3D.position.y.toFixed(2);
        var hlb = parseFloat(hy) >= 0 ? '+' + hy : hy;
        this.readout.setAttribute('text', 'value', 'floor offset  ' + hlb + ' m');
        this.readout.setAttribute('visible', 'true');
        this.readoutTimer = 60;
      }
    }

    // ── Custom locomotion — left thumbstick direct drive (VR only) ───────────
    if (!this._playerPosLock && this._leftCtrlEl && this._rigEl &&
        this.el.sceneEl.is('vr-mode')) {
      var ltcL = this._leftCtrlEl.components['tracked-controls-webxr'] ||
                 this._leftCtrlEl.components['tracked-controls'];
      var lgpL = ltcL && ltcL.controller && ltcL.controller.gamepad;
      if (lgpL && lgpL.axes.length >= 4) {
        var lmx = lgpL.axes[2];
        var lmy = lgpL.axes[3];
        if (Math.abs(lmx) > 0.15 || Math.abs(lmy) > 0.15) {
          if (this._camEl) {
            this._locoFwd.set(0, 0, -1);
            this._locoRight.set(1, 0, 0);
            this._camEl.object3D.getWorldQuaternion(this._locoCQ);
            this._locoFwd.applyQuaternion(this._locoCQ);
            this._locoFwd.y = 0;
            if (this._locoFwd.lengthSq() > 0.0001) this._locoFwd.normalize();
            this._locoRight.applyQuaternion(this._locoCQ);
            this._locoRight.y = 0;
            if (this._locoRight.lengthSq() > 0.0001) this._locoRight.normalize();
            var spd = (window._visitorMode ? 0.35 : 0.2) / 60;
            this._rigEl.object3D.position.x += this._locoFwd.x * (-lmy) * spd + this._locoRight.x * lmx * spd;
            this._rigEl.object3D.position.z += this._locoFwd.z * (-lmy) * spd + this._locoRight.z * lmx * spd;
          }
        }
      }
    }

    } catch (e) { console.error('vr-placer tick error:', e); }
  }
});

// ── RADIAL WHEEL MENU ────────────────────────────────────────────────────────
// Left trigger HOLD → wheel opens in front of you
// Left thumbstick direction → highlights a segment (8 items per page)
// Left thumbstick CLICK (while open) → cycle to next page
// Release left trigger → spawns highlighted item 2.5m ahead + closes wheel
//
// Configure items via: window._radialMenuItems = [{ id, name, src, scale }, ...]
// Add to scene: <a-scene radial-menu ...>
window._radialMenuOpen    = false;
window._leftTriggerShift  = false; // true when left trigger held while building in right hand → tilt mode
AFRAME.registerComponent('radial-menu', {
  init: function () {
    var self = this;
    self._open       = false;
    self._page       = 0;
    self._highlighted = -1;
    self._wheelEl    = null;
    self._segEls     = [];
    self._labelEls   = [];
    self._pageLabel  = null;
    self._nameLabel  = null;
    self._leftCtrlEl  = null;
    self._rightCtrlEl = null;
    self._spawnCounts     = {};
    self._lastHighlighted = -1;
    self._ghostEl   = null;  // semi-transparent preview at right controller position
    self._ghostItem = null;  // which item is currently ghosted
    self._ghostPos  = { x: 0, z: 0 }; // world position snapped to floor when trigger released
    self._ghostWp   = new THREE.Vector3(); // pre-allocated — ghost position tracking in tick

    this.el.sceneEl.addEventListener('loaded', function () {
      var leftCtrl  = document.querySelector('[oculus-touch-controls*="left"]');
      var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
      self._leftCtrlEl  = leftCtrl;
      self._rightCtrlEl = rightCtrl;
      self._buildWheel();

      // Ghost entity — semi-transparent building preview while wheel is open
      self._ghostEl = document.createElement('a-entity');
      self._ghostEl.setAttribute('visible', 'false');
      self.el.sceneEl.appendChild(self._ghostEl);

      if (leftCtrl) {
        leftCtrl.addEventListener('triggerdown', function () {
          // If a building is held in right hand, left trigger = tilt shift, not spawn wheel
          if (window._vrPlacerHeld) {
            window._leftTriggerShift = true;
            return;
          }
          self._open = true;
          window._radialMenuOpen = true;
          if (self._wheelEl) self._wheelEl.setAttribute('visible', 'true');
          self._highlighted = -1;
          self._refreshLabels();
        });

        leftCtrl.addEventListener('triggerup', function () {
          if (window._leftTriggerShift) {
            window._leftTriggerShift = false;
            return;
          }
          // Use last-known highlight — stick may have snapped back to centre first
          var slot = self._highlighted >= 0 ? self._highlighted : self._lastHighlighted;
          if (slot >= 0) {
            var items = self._items();
            var item  = items[self._page * 8 + slot];
            if (item) self._spawnItem(item, self._ghostPos);
          }
          self._open            = false;
          self._lastHighlighted = -1;
          window._radialMenuOpen = false;
          self._highlighted = -1;
          if (self._wheelEl) self._wheelEl.setAttribute('visible', 'false');
          if (self._nameLabel) self._nameLabel.setAttribute('text', 'value', '');
          self._hideGhost();
        });

        // Thumbstick click while open → cycle page
        leftCtrl.addEventListener('thumbstickdown', function () {
          if (!self._open) return;
          var totalPages = Math.ceil(self._items().length / 8);
          self._page = (self._page + 1) % totalPages;
          self._highlighted = -1;
          self._refreshLabels();
        });
      }
    });
  },

  _items: function () {
    return window._radialMenuItems || [];
  },

  _buildWheel: function () {
    var cam = document.querySelector('#cam');
    if (!cam) return;

    var wheel = document.createElement('a-entity');
    wheel.setAttribute('position', '0 -0.04 -0.58');
    wheel.setAttribute('visible', 'false');
    cam.appendChild(wheel);
    this._wheelEl = wheel;

    var INNER = 0.07, OUTER = 0.22, ARC = 40, GAP = 5;
    var MID   = (INNER + OUTER) / 2;

    for (var i = 0; i < 8; i++) {
      // Slot 0 at top (90°), going clockwise (decreasing angle in A-Frame ring)
      var centreAngle  = 90 - i * 45;
      var thetaStart   = ((centreAngle - ARC / 2) % 360 + 360) % 360;

      var seg = document.createElement('a-ring');
      seg.setAttribute('radius-inner', INNER);
      seg.setAttribute('radius-outer', OUTER);
      seg.setAttribute('theta-start',  thetaStart);
      seg.setAttribute('theta-length', ARC);
      seg.setAttribute('material', 'color:#1a2030; opacity:0.88; transparent:true; shader:flat; side:double');
      wheel.appendChild(seg);
      this._segEls.push(seg);

      // Label at midpoint of segment
      var aRad = centreAngle * Math.PI / 180;
      var lx   = Math.cos(aRad) * MID;
      var ly   = Math.sin(aRad) * MID;

      var lbl = document.createElement('a-text');
      lbl.setAttribute('position', lx + ' ' + ly + ' 0.002');
      lbl.setAttribute('align', 'center');
      lbl.setAttribute('baseline', 'center');
      lbl.setAttribute('color', '#aabbcc');
      lbl.setAttribute('width', '0.11');
      lbl.setAttribute('wrap-count', '9');
      lbl.setAttribute('material', 'shader:flat');
      lbl.setAttribute('value', '');
      wheel.appendChild(lbl);
      this._labelEls.push(lbl);
    }

    // Centre disc — page indicator
    var centre = document.createElement('a-circle');
    centre.setAttribute('radius', '0.062');
    centre.setAttribute('material', 'color:#0d1020; opacity:0.92; transparent:true; shader:flat; side:double');
    wheel.appendChild(centre);

    var pageLabel = document.createElement('a-text');
    pageLabel.setAttribute('position', '0 0.01 0.002');
    pageLabel.setAttribute('align', 'center');
    pageLabel.setAttribute('baseline', 'center');
    pageLabel.setAttribute('color', '#6688cc');
    pageLabel.setAttribute('width', '0.11');
    pageLabel.setAttribute('value', '');
    pageLabel.setAttribute('material', 'shader:flat');
    wheel.appendChild(pageLabel);
    this._pageLabel = pageLabel;

    var pageHint = document.createElement('a-text');
    pageHint.setAttribute('position', '0 -0.025 0.002');
    pageHint.setAttribute('align', 'center');
    pageHint.setAttribute('baseline', 'center');
    pageHint.setAttribute('color', '#445566');
    pageHint.setAttribute('width', '0.10');
    pageHint.setAttribute('value', 'click\nflip');
    pageHint.setAttribute('material', 'shader:flat');
    wheel.appendChild(pageHint);

    // Name label above the wheel
    var nameLabel = document.createElement('a-text');
    nameLabel.setAttribute('position', '0 0.30 0.002');
    nameLabel.setAttribute('align', 'center');
    nameLabel.setAttribute('color', '#ffffff');
    nameLabel.setAttribute('width', '0.50');
    nameLabel.setAttribute('value', '');
    nameLabel.setAttribute('material', 'shader:flat');
    wheel.appendChild(nameLabel);
    this._nameLabel = nameLabel;

    // Description label below the wheel (shown when a segment is highlighted)
    var descBg = document.createElement('a-plane');
    descBg.setAttribute('width', '0.52');
    descBg.setAttribute('height', '0.10');
    descBg.setAttribute('position', '0 -0.32 0');
    descBg.setAttribute('material', 'color:#0d1020; opacity:0.85; transparent:true; shader:flat; side:double');
    wheel.appendChild(descBg);

    var descLabel = document.createElement('a-text');
    descLabel.setAttribute('position', '0 -0.32 0.002');
    descLabel.setAttribute('align', 'center');
    descLabel.setAttribute('baseline', 'center');
    descLabel.setAttribute('color', '#88aacc');
    descLabel.setAttribute('width', '0.50');
    descLabel.setAttribute('wrap-count', '32');
    descLabel.setAttribute('value', '');
    descLabel.setAttribute('material', 'shader:flat');
    wheel.appendChild(descLabel);
    this._descLabel = descLabel;

    this._refreshLabels();
  },

  _refreshLabels: function () {
    var items      = this._items();
    var pageStart  = this._page * 8;
    var totalPages = Math.ceil(items.length / 8);

    for (var i = 0; i < 8; i++) {
      var item = items[pageStart + i];
      var lbl  = this._labelEls[i];
      var seg  = this._segEls[i];
      if (!lbl || !seg) continue;
      if (item) {
        lbl.setAttribute('text', 'value', item.name);
        seg.setAttribute('material', 'color:#1a2030; opacity:0.88; transparent:true; shader:flat; side:double');
      } else {
        lbl.setAttribute('text', 'value', '');
        seg.setAttribute('material', 'color:#0d0d18; opacity:0.50; transparent:true; shader:flat; side:double');
      }
    }

    if (this._pageLabel) {
      this._pageLabel.setAttribute('text', 'value', (this._page + 1) + ' / ' + (totalPages || 1));
    }
  },

  _spawnItem: function (item, ghostPos) {
    var cam = document.querySelector('#cam');
    var rig = document.querySelector('#rig');
    if (!cam || !rig) return;

    var px, pz;
    if (ghostPos) {
      // Spawn exactly where the ghost was (right controller floor position)
      px = ghostPos.x.toFixed(2);
      pz = ghostPos.z.toFixed(2);
    } else {
      // Fallback: spiral ahead of camera
      var fwd  = new THREE.Vector3(0, 0, -1);
      var quat = new THREE.Quaternion();
      cam.object3D.getWorldQuaternion(quat);
      fwd.applyQuaternion(quat);
      fwd.y = 0;
      if (fwd.length() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      var rigPos = rig.object3D.position;
      var _totalSpawned = 0;
      var _sc = this._spawnCounts;
      Object.keys(_sc).forEach(function (k) { _totalSpawned += _sc[k]; });
      var _angle  = _totalSpawned * 2.399;
      var _radius = 1.5 + _totalSpawned * 0.4;
      px = (rigPos.x + fwd.x * 3.0 + Math.cos(_angle) * _radius).toFixed(2);
      pz = (rigPos.z + fwd.z * 3.0 + Math.sin(_angle) * _radius).toFixed(2);
    }

    // Unique name: base + count
    this._spawnCounts[item.id] = (this._spawnCounts[item.id] || 0) + 1;
    var name = item.id + '-' + this._spawnCounts[item.id];

    var entity = document.createElement('a-entity');
    entity.setAttribute('class', 'placeable');
    entity.setAttribute('night-aware', '');
    entity.setAttribute('data-name', name);
    entity.setAttribute('gltf-model', item.src);
    entity.setAttribute('position',   px + ' 0 ' + pz);
    entity.setAttribute('scale',      item.scale + ' ' + item.scale + ' ' + item.scale);
    this.el.sceneEl.appendChild(entity);

    // Register with vr-placer so it can be grabbed immediately
    var placer = this.el.sceneEl.components['vr-placer'];
    if (placer) {
      var sc = item.scale;
      placer.originals[name] = { x: parseFloat(px), y: 0, z: parseFloat(pz), rotY: 0, scale: sc };
      entity.addEventListener('model-loaded', function () {
        requestAnimationFrame(function () {
          var box = new THREE.Box3().setFromObject(entity.object3D);
          placer.bboxCache[name] = { el: entity, box: box, lastPos: entity.object3D.position.clone() };
          placer.bboxKeys = Object.keys(placer.bboxCache);
          // Apply night tint if scene is in night mode
          if (window._nightMode && entity.components['night-aware']) {
            entity.components['night-aware'].applyNight(true);
          }
        });
      });
      // Floating name label
      var lbl = document.createElement('a-text');
      lbl.setAttribute('value', name);
      lbl.setAttribute('position', '0 3 0');
      lbl.setAttribute('align', 'center');
      lbl.setAttribute('color', '#ffee88');
      lbl.setAttribute('width', '12');
      lbl.setAttribute('material', 'shader:flat');
      entity.appendChild(lbl);
    }
  },

  tick: function () {
    if (!this._open) return;

    // ── Ghost position: track to floor below right controller ────────────
    if (this._ghostEl && this._rightCtrlEl) {
      this._rightCtrlEl.object3D.getWorldPosition(this._ghostWp);
      this._ghostEl.object3D.position.set(this._ghostWp.x, 0, this._ghostWp.z);
      this._ghostPos.x = this._ghostWp.x;
      this._ghostPos.z = this._ghostWp.z;
    }

    // ── Highlight detection: left stick direction ─────────────────────────
    if (!this._leftCtrlEl) return;
    var ltc = this._leftCtrlEl.components['tracked-controls-webxr'] ||
              this._leftCtrlEl.components['tracked-controls'];
    var lgp = ltc && ltc.controller && ltc.controller.gamepad;
    if (!lgp || lgp.axes.length < 4) return;

    var sx  = lgp.axes[2];
    var sy  = lgp.axes[3];
    var mag = Math.sqrt(sx * sx + sy * sy);

    var newHighlight = -1;
    if (mag > 0.35) {
      var angle = Math.atan2(sx, -sy) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      newHighlight = Math.round(angle / 45) % 8;
      var items = this._items();
      if (!items[this._page * 8 + newHighlight]) newHighlight = -1;
    }

    if (newHighlight === this._highlighted) return;
    this._highlighted = newHighlight;
    if (newHighlight >= 0) this._lastHighlighted = newHighlight;

    // Update visual highlight on segments
    var items = this._items();
    for (var i = 0; i < 8; i++) {
      var seg  = this._segEls[i];
      var lbl  = this._labelEls[i];
      if (!seg) continue;
      var hasItem = !!items[this._page * 8 + i];
      if (i === newHighlight) {
        seg.setAttribute('material', 'color:#3366ff; opacity:0.95; transparent:true; shader:flat; side:double');
        if (lbl) lbl.setAttribute('text', 'color', '#ffffff');
      } else {
        seg.setAttribute('material', 'color:' + (hasItem ? '#1a2030' : '#0d0d18') + '; opacity:' + (hasItem ? '0.88' : '0.50') + '; transparent:true; shader:flat; side:double');
        if (lbl) lbl.setAttribute('text', 'color', '#aabbcc');
      }
    }

    // Name / description labels + ghost preview
    if (this._nameLabel || this._descLabel) {
      var item = newHighlight >= 0 ? items[this._page * 8 + newHighlight] : null;
      if (this._nameLabel) this._nameLabel.setAttribute('text', 'value', item ? item.name : '');
      if (this._descLabel) this._descLabel.setAttribute('text', 'value', item ? (item.desc || '') : '');
      this._showGhost(item || null);
    }
  },

  _showGhost: function (item) {
    if (!this._ghostEl) return;
    if (!item) { this._hideGhost(); return; }
    if (item === this._ghostItem) return; // same item already loaded
    this._ghostItem = item;
    this._ghostEl.setAttribute('gltf-model', item.src);
    this._ghostEl.setAttribute('scale', item.scale + ' ' + item.scale + ' ' + item.scale);
    this._ghostEl.setAttribute('visible', 'true');
    // Make semi-transparent after the model finishes loading
    var _ghostRef = this._ghostEl;
    var _onLoad = function () {
      _ghostRef.removeEventListener('model-loaded', _onLoad);
      _ghostRef.object3D.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { m.transparent = true; m.opacity = 0.38; });
      });
    };
    this._ghostEl.addEventListener('model-loaded', _onLoad);
  },

  _hideGhost: function () {
    this._ghostItem = null;
    if (this._ghostEl) {
      this._ghostEl.setAttribute('visible', 'false');
      this._ghostEl.removeAttribute('gltf-model');
    }
  },

});



// ── CONTROL PANEL ─────────────────────────────────────────────────────────────
// B button (right) → open / close 5 × 3 grid of all controls
// Right stick      → navigate grid (row/col)
// A button         → activate highlighted cell
//
// Items: 5 columns × 3 rows = 15 slots.  null = empty cell.
// isMode: which _toolMode value this cell represents (for active highlight)
// special: 'reset' = two-step confirmation.  info: true = display-only tile.
var _CP_ITEMS = [
  // Row 0 — Tool modes + undo/redo
  { id:'normal',  label:'NORMAL',  sub:'spin + scale',  isMode:0, fn:function(p){if(p)p._toolMode=0; return 'NORMAL mode';} },
  { id:'tilt',    label:'TILT',    sub:'lean X / Z',    isMode:1, fn:function(p){if(p)p._toolMode=1; return 'TILT mode';} },
  { id:'height',  label:'HEIGHT',  sub:'raise / lower', isMode:2, fn:function(p){if(p)p._toolMode=2; return 'HEIGHT mode';} },
  { id:'undo',    label:'UNDO',    sub:'last action',   fn:function(p){return p&&p.doUndo?p.doUndo():'';} },
  { id:'redo',    label:'REDO',    sub:'redo action',   fn:function(p){return p&&p.doRedo?p.doRedo():'';} },
  // Row 1 — Build actions + scene
  { id:'clone',   label:'CLONE',   sub:'copy held',     fn:function(p){return p&&p.doClone?p.doClone():'';} },
  { id:'snap',    label:'FLOOR',   sub:'snap to floor', fn:function(p){return p&&p.doFloorSnap?p.doFloorSnap():'';} },
  { id:'lock',    label:'LOCK',    sub:'toggle lock',   fn:function(p){return p&&p.doLockToggle?p.doLockToggle():'';} },
  { id:'night',   label:'DAY/NGT', sub:'toggle sky',    fn:function(){if(window.toggleNight)window.toggleNight(); return 'day / night';} },
  { id:'visitor', label:'VISITOR', sub:'walk / build',  fn:function(){if(window.toggleVisitorMode)window.toggleVisitorMode(); return 'visitor mode';} },
  // Row 2 — Save, reset, spawn info
  { id:'save',    label:'SAVE',    sub:'save layout',   fn:function(p){return p&&p.doSave?p.doSave():'';} },
  { id:'reset',   label:'RESET',   sub:'clear all',     special:'reset', fn:null },
  { id:'slow',    label:'SLOW',    sub:'1:1 hand move',  fn:function(){ window._slowMoveMode = !window._slowMoveMode; return window._slowMoveMode ? 'SLOW move  ON' : 'SLOW move  OFF'; } },
  { id:'grid',    label:'GRID',    sub:'0.5 m snap',    fn:function(){ window._gridSnap = !window._gridSnap; return window._gridSnap ? 'Grid snap  ON' : 'Grid snap  OFF'; } },
  { id:'help',    label:'HELP',    sub:'controls guide', fn:function(){ if (window._openHelpPanel) window._openHelpPanel(); return ''; } }
];

window._controlPanelOpen = false;
window._gridSnap         = false; // when true, building positions snap to 0.5 m grid on release
window._slowMoveMode     = false; // when true, building moves 1:1 with hand (no laser projection)

AFRAME.registerComponent('control-panel', {
  init: function () {
    var self = this;
    self._open          = false;
    self._col           = 0;
    self._row           = 0;
    self._panelEl       = null;
    self._cellEls       = [];  // 15 cells, row-major
    self._descEl        = null;
    self._navLocked     = false;
    self._resetPending  = false;
    self._rightCtrlEl   = null;

    this.el.sceneEl.addEventListener('loaded', function () {
      self._buildPanel();
      self._bindControls();
      window._cpActivate = function () { self._activate(); };
      window._cpClose    = function () { self._close(); };
    });
  },

  _bindControls: function () {
    var self = this;
    var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
    if (!rightCtrl) { setTimeout(function () { self._bindControls(); }, 500); return; }
    self._rightCtrlEl = rightCtrl;

    rightCtrl.addEventListener('bbuttondown', function () {
      if (self._open) { self._close(); } else { self._openPanel(); }
    });
  },

  _openPanel: function () {
    this._open = true;
    window._controlPanelOpen = true;
    this._col = 0; this._row = 0;
    this._navLocked    = true;   // wait for stick to re-centre before first move
    this._resetPending = false;
    this._refresh();
    if (this._panelEl) this._panelEl.setAttribute('visible', 'true');
  },

  _close: function () {
    this._open = false;
    window._controlPanelOpen = false;
    this._resetPending = false;
    if (this._panelEl) this._panelEl.setAttribute('visible', 'false');
  },

  _activate: function () {
    var idx  = this._row * 5 + this._col;
    var item = _CP_ITEMS[idx];
    if (!item || item.info) return;   // empty or display-only

    // RESET: two-step confirmation
    if (item.special === 'reset') {
      if (!this._resetPending) {
        this._resetPending = true;
        this._refresh();   // description updates to show confirm prompt
      } else {
        if (window._doReset) window._doReset();
        this._close();
      }
      return;
    }

    this._close(); // close panel first so it doesn't overlap help or readout
    if (item.fn) {
      var placer = this.el.sceneEl.components['vr-placer'];
      var msg = item.fn(placer);
      if (msg && placer && placer.readout) {
        placer.readout.setAttribute('text', 'value', msg);
        placer.readout.setAttribute('visible', 'true');
        placer.readoutTimer = 90;
      }
    }
  },

  tick: function () {
    if (!this._open || !this._rightCtrlEl) return;

    var tc = this._rightCtrlEl.components['tracked-controls-webxr'] ||
             this._rightCtrlEl.components['tracked-controls'];
    var gp = tc && tc.controller && tc.controller.gamepad;
    if (!gp || gp.axes.length < 4) return;

    var sx = gp.axes[2];
    var sy = gp.axes[3];

    // Require stick to return to centre before accepting a new move
    if (Math.abs(sx) < 0.3 && Math.abs(sy) < 0.3) {
      this._navLocked = false;
      return;
    }
    if (this._navLocked) return;

    // Move on the dominant axis
    var moved = false;
    if (Math.abs(sx) >= Math.abs(sy)) {
      if (sx >  0.5) { this._col = Math.min(4, this._col + 1); moved = true; }
      else if (sx < -0.5) { this._col = Math.max(0, this._col - 1); moved = true; }
    } else {
      if (sy >  0.5) { this._row = Math.min(2, this._row + 1); moved = true; }
      else if (sy < -0.5) { this._row = Math.max(0, this._row - 1); moved = true; }
    }
    if (moved) {
      this._navLocked    = true;
      this._resetPending = false; // cancel pending reset if cursor moved away
      this._refresh();
    }
  },

  _buildPanel: function () {
    var cam = document.querySelector('#cam');
    if (!cam) return;

    var panel = document.createElement('a-entity');
    panel.setAttribute('position', '0 0.04 -0.60');
    panel.setAttribute('visible', 'false');
    cam.appendChild(panel);
    this._panelEl = panel;

    // Panel backing
    var bg = document.createElement('a-plane');
    bg.setAttribute('width',  '0.75');
    bg.setAttribute('height', '0.50');
    bg.setAttribute('position', '0 -0.025 -0.001');
    bg.setAttribute('material', 'color:#070c16; opacity:0.96; transparent:true; shader:flat; side:double');
    panel.appendChild(bg);

    // Title
    var title = document.createElement('a-text');
    title.setAttribute('value', '— CONTROL PANEL —');
    title.setAttribute('align', 'center');
    title.setAttribute('color', '#8899bb');
    title.setAttribute('width', '0.73');
    title.setAttribute('position', '0 0.215 0.001');
    title.setAttribute('material', 'shader:flat');
    panel.appendChild(title);

    // Grid — 5 cols × 3 rows
    var CW = 0.130, CH = 0.100, GAP = 0.009;
    var totalW = 5 * CW + 4 * GAP;
    var sx0 = -totalW / 2 + CW / 2;
    var sy0 = 0.148;

    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 5; c++) {
        var idx  = r * 5 + c;
        var item = _CP_ITEMS[idx];
        var cx   = sx0 + c * (CW + GAP);
        var cy   = sy0 - r * (CH + GAP);

        var cell = document.createElement('a-entity');
        cell.setAttribute('position', cx + ' ' + cy + ' 0');
        panel.appendChild(cell);
        this._cellEls.push(cell);

        var cbg = document.createElement('a-plane');
        cbg.setAttribute('width',  CW);
        cbg.setAttribute('height', CH);
        cbg.setAttribute('material', 'color:#111827; opacity:' + (item ? '0.92' : '0.25') + '; transparent:true; shader:flat; side:double');
        cell.appendChild(cbg);
        cell._bg = cbg;

        if (item) {
          var nameEl = document.createElement('a-text');
          nameEl.setAttribute('value', item.label);
          nameEl.setAttribute('align', 'center');
          nameEl.setAttribute('baseline', 'center');
          nameEl.setAttribute('color', item.info ? '#445566' : '#cce0f0');
          nameEl.setAttribute('width', '0.22');
          nameEl.setAttribute('position', '0 0.022 0.002');
          nameEl.setAttribute('material', 'shader:flat');
          cell.appendChild(nameEl);
          cell._nameEl = nameEl;

          var subEl = document.createElement('a-text');
          subEl.setAttribute('value', item.sub || '');
          subEl.setAttribute('align', 'center');
          subEl.setAttribute('baseline', 'center');
          subEl.setAttribute('color', '#6699bb');
          subEl.setAttribute('width', '0.19');
          subEl.setAttribute('position', '0 -0.021 0.002');
          subEl.setAttribute('material', 'shader:flat');
          cell.appendChild(subEl);
          cell._subEl = subEl;
        }
      }
    }

    // Description strip at bottom
    var dBg = document.createElement('a-plane');
    dBg.setAttribute('width', '0.73');
    dBg.setAttribute('height', '0.055');
    dBg.setAttribute('position', '0 -0.226 -0.001');
    dBg.setAttribute('material', 'color:#040810; opacity:0.97; transparent:true; shader:flat; side:double');
    panel.appendChild(dBg);

    var descEl = document.createElement('a-text');
    descEl.setAttribute('value', 'R-stick: navigate   A: activate   B: close');
    descEl.setAttribute('align', 'center');
    descEl.setAttribute('baseline', 'center');
    descEl.setAttribute('color', '#334455');
    descEl.setAttribute('width', '0.70');
    descEl.setAttribute('position', '0 -0.226 0.001');
    descEl.setAttribute('material', 'shader:flat');
    panel.appendChild(descEl);
    this._descEl = descEl;
  },

  _refresh: function () {
    var placer     = this.el.sceneEl.components['vr-placer'];
    var activeMode = placer ? placer._toolMode : 0;
    var selIdx     = this._row * 5 + this._col;

    for (var i = 0; i < 15; i++) {
      var cell = this._cellEls[i];
      if (!cell || !cell._bg) continue;
      var item   = _CP_ITEMS[i];
      var isSel  = (i === selIdx);
      var isMode = item && (item.isMode !== undefined) && (item.isMode === activeMode);

      var bgColor = isSel   ? '#1a3c70'
                  : isMode  ? '#0a2818'
                  : item    ? '#111827'
                  : '#060c16';
      var opac    = item ? '0.95' : '0.20';
      cell._bg.setAttribute('material',
        'color:' + bgColor + '; opacity:' + opac + '; transparent:true; shader:flat; side:double');

      if (cell._nameEl) {
        var nc = isSel  ? '#ffffff'
               : isMode ? '#44ff88'
               : item && item.info ? '#3a5066'
               : item && item.special === 'reset' && this._resetPending ? '#ff6666'
               : '#cce0f0';
        cell._nameEl.setAttribute('text', 'color', nc);
      }
      if (cell._subEl) {
        cell._subEl.setAttribute('text', 'color', isSel ? '#99ccff' : '#6699bb');
      }
    }

    // Description text for selected cell
    if (this._descEl) {
      var si = _CP_ITEMS[selIdx];
      var desc;
      if (!si) {
        desc = 'R-stick: navigate   A: activate   B: close';
      } else if (si.special === 'reset') {
        desc = this._resetPending
          ? 'CONFIRM?  press A again to clear all buildings — cannot be undone'
          : 'RESET MAP: removes all placed buildings (will ask to confirm)';
      } else {
        desc = si.label + ':  ' + (si.sub || '') + '   —   R-stick navigate  A activate  B close';
      }
      this._descEl.setAttribute('text', 'value', desc);
    }
  }
});

// ── HELP PANEL ───────────────────────────────────────────────────────────────
// Camera-space overlay, one topic per page, white background, dark text.
// Open: B → HELP in control panel.   Close: A button.   Navigate: right stick ←→
//
window._helpPanelIsOpen = false;
window._openHelpPanel   = null; // set by component init
window._closeHelpPanel  = null;

AFRAME.registerComponent('help-panel', {
  init: function () {
    var self = this;
    self._open      = false;
    self._page      = 0;
    self._panelEl   = null;
    self._titleEl   = null;
    self._bodyEl    = null;
    self._pageEl    = null;
    self._navLocked = false;

    var _PAGES = [
      {
        title: 'GRABBING  (right hand)',
        body:  [
          'Hold  RIGHT GRIP',
          'Sweep laser onto any building',
          'It snaps into your hand',
          ' ',
          'Laser is CYAN  =  no target',
          'Laser is ORANGE  =  locked on',
          ' ',
          'Release GRIP to drop'
        ]
      },
      {
        title: 'MOVING & ROTATING',
        body:  [
          'WHILE HOLDING a building:',
          ' ',
          'Right stick  LEFT / RIGHT',
          '  →  Rotate around centre',
          ' ',
          'Right stick  UP / DOWN',
          '  →  Scale up / down',
          ' ',
          'Right stick CLICK',
          '  →  Reset to original size'
        ]
      },
      {
        title: 'HEIGHT & TILT',
        body:  [
          'RAISE / LOWER:',
          'Hold LEFT GRIP',
          'Left stick  UP / DOWN',
          '  moves building on Y axis',
          ' ',
          'TILT / LEAN:',
          'Hold building  +  hold LEFT TRIGGER',
          'Stick X / Y  leans the building',
          ' ',
          'A button  =  snap level  /  floor'
        ]
      },
      {
        title: 'SPAWNING A BUILDING',
        body:  [
          'Hold LEFT TRIGGER',
          '  →  Spawn wheel opens',
          ' ',
          'Move left stick to pick a building',
          ' ',
          'Point your RIGHT HAND at the',
          'floor where you want it',
          ' ',
          'A ghost preview appears',
          ' ',
          'Release LEFT TRIGGER to place'
        ]
      },
      {
        title: 'BUTTONS & PANEL',
        body:  [
          'B button  →  Control Panel',
          '  Navigate with right stick',
          '  A button to activate',
          ' ',
          'X button  →  Delete building',
          '  (point at it or hold it)',
          ' ',
          'Y button  →  Copy layout',
          '  to clipboard',
          ' ',
          'Left stick CLICK  →  Undo'
        ]
      }
    ];
    self._pages = _PAGES;

    this.el.sceneEl.addEventListener('loaded', function () {
      var cam = document.querySelector('#cam');
      if (!cam) return;

      // ── Root panel entity — parented to camera ────────────────────────
      var panel = document.createElement('a-entity');
      panel.setAttribute('position', '0 0.02 -1.05');
      panel.setAttribute('visible', 'false');
      cam.appendChild(panel);
      self._panelEl = panel;

      // ── White background ──────────────────────────────────────────────
      var bg = document.createElement('a-plane');
      bg.setAttribute('width',    '0.68');
      bg.setAttribute('height',   '0.60');
      bg.setAttribute('material', 'color:#ffffff; shader:flat; side:double');
      panel.appendChild(bg);

      // ── Thin navy top bar ─────────────────────────────────────────────
      var topBar = document.createElement('a-plane');
      topBar.setAttribute('width',    '0.68');
      topBar.setAttribute('height',   '0.072');
      topBar.setAttribute('position', '0 0.264 0.001');
      topBar.setAttribute('material', 'color:#1a2a4a; shader:flat; side:double');
      panel.appendChild(topBar);

      // ── Title text (white on navy bar) ────────────────────────────────
      var titleEl = document.createElement('a-text');
      titleEl.setAttribute('position', '0 0.261 0.003');
      titleEl.setAttribute('align',    'center');
      titleEl.setAttribute('baseline', 'center');
      titleEl.setAttribute('color',    '#ffffff');
      titleEl.setAttribute('width',    '0.62');
      titleEl.setAttribute('value',    '');
      titleEl.setAttribute('material', 'shader:flat');
      panel.appendChild(titleEl);
      self._titleEl = titleEl;

      // ── Body text (dark on white) ─────────────────────────────────────
      var bodyEl = document.createElement('a-text');
      bodyEl.setAttribute('position',    '-0.31 0.17 0.002');
      bodyEl.setAttribute('align',       'left');
      bodyEl.setAttribute('baseline',    'top');
      bodyEl.setAttribute('color',       '#1a2a4a');
      bodyEl.setAttribute('width',       '0.60');
      bodyEl.setAttribute('line-height', '52');
      bodyEl.setAttribute('value',       '');
      bodyEl.setAttribute('material',    'shader:flat');
      panel.appendChild(bodyEl);
      self._bodyEl = bodyEl;

      // ── Bottom strip — page number + nav hint ─────────────────────────
      var bottomBar = document.createElement('a-plane');
      bottomBar.setAttribute('width',    '0.68');
      bottomBar.setAttribute('height',   '0.058');
      bottomBar.setAttribute('position', '0 -0.271 0.001');
      bottomBar.setAttribute('material', 'color:#e8eef6; shader:flat; side:double');
      panel.appendChild(bottomBar);

      var pageEl = document.createElement('a-text');
      pageEl.setAttribute('position', '-0.30 -0.270 0.003');
      pageEl.setAttribute('align',    'left');
      pageEl.setAttribute('baseline', 'center');
      pageEl.setAttribute('color',    '#556677');
      pageEl.setAttribute('width',    '0.25');
      pageEl.setAttribute('value',    '');
      pageEl.setAttribute('material', 'shader:flat');
      panel.appendChild(pageEl);
      self._pageEl = pageEl;

      var navHint = document.createElement('a-text');
      navHint.setAttribute('position', '0.30 -0.270 0.003');
      navHint.setAttribute('align',    'right');
      navHint.setAttribute('baseline', 'center');
      navHint.setAttribute('color',    '#889aaa');
      navHint.setAttribute('width',    '0.38');
      navHint.setAttribute('value',    'stick \u2190\u2192 page   A = close');
      navHint.setAttribute('material', 'shader:flat');
      panel.appendChild(navHint);

      // ── Expose globals ────────────────────────────────────────────────
      window._openHelpPanel = function () {
        self._page = 0;
        self._render();
        self._panelEl.setAttribute('visible', 'true');
        self._open = true;
        window._helpPanelIsOpen = true;
      };
      window._closeHelpPanel = function () {
        self._panelEl.setAttribute('visible', 'false');
        self._open = false;
        window._helpPanelIsOpen = false;
      };
    });
  },

  _render: function () {
    var p = this._pages[this._page];
    if (!p || !this._titleEl) return;
    this._titleEl.setAttribute('text', 'value', p.title);
    this._bodyEl.setAttribute('text',  'value', p.body.join('\n'));
    this._pageEl.setAttribute('text',  'value', (this._page + 1) + ' / ' + this._pages.length);
  },

  tick: function () {
    if (!this._open) return;
    var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
    if (!rightCtrl) return;
    var tc = rightCtrl.components['tracked-controls-webxr'] ||
             rightCtrl.components['tracked-controls'];
    var gp = tc && tc.controller && tc.controller.gamepad;
    if (!gp) return;
    var ax = gp.axes[2];
    if (Math.abs(ax) > 0.55) {
      if (!this._navLocked) {
        if (ax > 0) this._page = Math.min(this._page + 1, this._pages.length - 1);
        else        this._page = Math.max(this._page - 1, 0);
        this._render();
        this._navLocked = true;
      }
    } else if (Math.abs(ax) < 0.25) {
      this._navLocked = false;
    }
  }
});
