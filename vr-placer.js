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
    self._leftOrigin  = new THREE.Vector3();
    self._leftDir     = new THREE.Vector3();
    self._leftDist    = new THREE.Vector3();
    self._leftQuat    = new THREE.Quaternion();
    self._spinPivot   = new THREE.Vector3();
    self._spinOffset  = new THREE.Vector3();
    self._holdOffset  = new THREE.Vector3();
    self._btnPts      = null;
    self._nudgeX      = false;
    self._nudgeZ      = false;
    self._tiltMode    = false;
    self._toolMode    = 0; // 0=normal 1=tilt 2=height (right stick Y)

    this.el.sceneEl.addEventListener('loaded', function () {
      var cam       = document.querySelector('#cam');
      var rigEl     = document.querySelector('#rig');
      self._rigEl   = rigEl;
      var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
      var leftCtrl  = document.querySelector('[oculus-touch-controls*="left"]');
      self._rightCtrlEl = rightCtrl;
      self._leftCtrlEl  = leftCtrl;

      // World-space clickable buttons — scene can override via window._vrPlacerBtnPts
      self._btnPts = window._vrPlacerBtnPts || [
        { pos: new THREE.Vector3(5.5,  1.15, -33), fn: function () { if (window.toggleNight) window.toggleNight(); } },
        { pos: new THREE.Vector3(10.9, 1.15, -33), fn: function () { if (window.toggleVisitorMode) window.toggleVisitorMode(); } }
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
      laserPivot.setAttribute('visible', 'false');
      var laser = document.createElement('a-box');
      laser.setAttribute('width',  '0.005');
      laser.setAttribute('height', '0.005');
      laser.setAttribute('depth',  '20');
      laser.setAttribute('position', '0 0 -10');
      laser.setAttribute('material', 'color:#00ffcc; emissive:#00ffcc; emissiveIntensity:1; shader:flat; opacity:0.6; transparent:true');
      laserPivot.appendChild(laser);
      if (rightCtrl) rightCtrl.appendChild(laserPivot);
      self.laser      = laser;
      self.laserPivot = laserPivot;

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
      self.readoutTimer = 0;
      self.outPanel = outPanel;
      self.outText  = outText;

      // ── Right controller ─────────────────────────────────────────────────
      if (rightCtrl) {
        rightCtrl.addEventListener('gripdown', function () {
          self.gripping = true;
          laserPivot.setAttribute('visible', 'true');
          if (rigEl) {
            self._playerRotLock = rigEl.object3D.rotation.y;
            self._playerPosLock = { x: rigEl.object3D.position.x, z: rigEl.object3D.position.z };
          }
          try { if (rigEl) rigEl.setAttribute('movement-controls', 'fly: false; speed: 0; camera: #cam'); } catch(e) {}
          if (self.hovered) {
            self.history.push({
              el:    self.hovered,
              x:     self.hovered.object3D.position.x,
              z:     self.hovered.object3D.position.z,
              rotY:  self.hovered.object3D.rotation.y,
              scale: self.hovered.object3D.scale.x
            });
            self.held = self.hovered;
            // Spin pivot = building centre XZ — rotates around its own axis
            self._spinPivot.set(
              self.held.object3D.position.x, 0,
              self.held.object3D.position.z
            );
            self._spinOffset.set(0, 0, 0);
            // Immediately start dragging — no trigger press needed
            self.moving = true;
            laserPivot.object3D.getWorldPosition(self._tickOrigin);
            self._holdOffset.set(
              self.held.object3D.position.x - self._tickOrigin.x,
              0,
              self.held.object3D.position.z - self._tickOrigin.z
            );
          }
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
          self._toolMode = 0;
          laserPivot.setAttribute('visible', 'false');
          self._playerRotLock = null;
          self._playerPosLock = null;
          try { if (rigEl) rigEl.setAttribute('movement-controls', 'fly: false; speed: 0.8; camera: #cam'); } catch(e) {}
          if (justReleased) {
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
            // Re-lock hold offset from current position (fine-tune grab point)
            self.moving = true;
            laserPivot.object3D.getWorldPosition(self._tickOrigin);
            self._holdOffset.set(
              self.held.object3D.position.x - self._tickOrigin.x,
              0,
              self.held.object3D.position.z - self._tickOrigin.z
            );
          }
          if (self._btnPts) {
            // Button ray: controller forward direction (NOT the 45°-down laser)
            rightCtrl.object3D.getWorldPosition(self._tickOrigin);
            rightCtrl.object3D.getWorldQuaternion(self.tmpQuat);
            self._tickDir.set(0, 0, -1).applyQuaternion(self.tmpQuat).normalize();
            for (var bi = 0; bi < self._btnPts.length; bi++) {
              var toBtn = new THREE.Vector3().subVectors(self._btnPts[bi].pos, self._tickOrigin).normalize();
              if (toBtn.dot(self._tickDir) > 0.92) { // ~23° cone — generous for world buttons
                self._btnPts[bi].fn();
                break;
              }
            }
          }
        });
        rightCtrl.addEventListener('triggerup', function () {
          // Keep moving = true after triggerup (drag continues from grip)
        });

        rightCtrl.addEventListener('thumbstickmoved', function (e) {
          self.stickX = e.detail.x;
          self.scaleY = e.detail.y;
        });

        // A button — floor snap, or snap to level in tilt mode
        rightCtrl.addEventListener('abuttondown', function () {
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

        // Right stick click while holding — cycle tool mode
        // Normal → Tilt → Height → Normal
        rightCtrl.addEventListener('thumbstickdown', function () {
          if (self.held) {
            self._toolMode = (self._toolMode + 1) % 3;
            var modeNames = ['NORMAL  (spin + scale)', 'TILT  (lean X / Z)', 'HEIGHT  (raise / lower)'];
            if (self.readout) {
              self.readout.setAttribute('text', 'value', modeNames[self._toolMode]);
              self.readout.setAttribute('visible', 'true');
              self.readoutTimer = 150;
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
          if (window._radialMenuOpen) return; // menu open — hand off to radial-menu
          if (self.history.length === 0) return;
          var last = self.history.pop();
          last.el.object3D.position.x  = last.x;
          last.el.object3D.position.z  = last.z;
          last.el.object3D.rotation.y  = last.rotY;
          last.el.object3D.scale.setScalar(last.scale);
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

        // X + Right grip — reset held building to original position
        leftCtrl.addEventListener('xbuttondown', function () {
          if (self.gripping && self.held) {
            var id   = self.held.getAttribute('data-name');
            var orig = self.originals[id];
            if (orig) {
              self.held.object3D.position.x = orig.x;
              self.held.object3D.position.z = orig.z;
              self.held.object3D.rotation.y = orig.rotY;
              self.held.object3D.scale.setScalar(orig.scale);
            }
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

      // ── Helpers ──────────────────────────────────────────────────────────
      function decoratePlaceable(el) {
        var name = el.getAttribute('data-name') || '';
        if (!name) return;
        var lbl = document.createElement('a-text');
        lbl.setAttribute('value', name);
        lbl.setAttribute('position', '0 8 0');
        lbl.setAttribute('align', 'center');
        lbl.setAttribute('color', '#ffee88');
        lbl.setAttribute('width', '12');
        lbl.setAttribute('material', 'shader:flat');
        el.appendChild(lbl);
      }

      function cloneHeld() {
        if (!self.held) return;
        var srcName = self.held.getAttribute('data-name');
        self.cloneCounts[srcName] = (self.cloneCounts[srcName] || 0) + 1;
        var newName = srcName + '-' + self.cloneCounts[srcName];
        var clone = document.createElement('a-entity');
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
        self.held = clone;
      }

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

    // Lock rig rotation + position every frame while gripping
    if (this._rigEl && this._playerRotLock !== null) {
      this._rigEl.object3D.rotation.y = this._playerRotLock;
    }
    if (this._rigEl && this._playerPosLock !== null) {
      this._rigEl.object3D.position.x = this._playerPosLock.x;
      this._rigEl.object3D.position.z = this._playerPosLock.z;
    }

    // Rolling bbox refresh — 1 building per frame to keep hover accurate
    if (!this.gripping && this.bboxKeys.length > 0) {
      var rbIdx   = this.frameCount % this.bboxKeys.length;
      var rbKey   = this.bboxKeys[rbIdx];
      var rbEntry = this.bboxCache[rbKey];
      if (rbEntry && rbEntry.el) {
        var newBox = new THREE.Box3().setFromObject(rbEntry.el.object3D);
        rbEntry.box = newBox;
        rbEntry.lastPos.copy(rbEntry.el.object3D.position);
      }
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
    }

    if (!this.held) { } else {

    // ── Move: offset-locked to controller ────────────────────────────────
    if (this.moving) {
      this.laserPivot.object3D.getWorldPosition(this._tickOrigin);
      this.held.object3D.position.x = this._tickOrigin.x + this._holdOffset.x;
      this.held.object3D.position.z = this._tickOrigin.z + this._holdOffset.z;
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

    // ── Tool modes — cycled with right stick click while holding ─────────
    // Mode 0 Normal: right stick X = spin, Y = scale
    // Mode 1 Tilt:   right stick X = lean Z, Y = lean X (A to snap level)
    // Mode 2 Height: right stick Y = raise/lower
    this._tiltMode = (this._toolMode === 1);

    if (this._toolMode === 1) {
      // ── TILT MODE ────────────────────────────────────────────────────────
      if (Math.abs(this.stickX) > 0.15)
        this.held.object3D.rotation.z += this.stickX * 0.018;
      if (Math.abs(this.scaleY) > 0.15)
        this.held.object3D.rotation.x += this.scaleY * 0.018;
      if (this.readout && this.frameCount % 6 === 0) {
        var rx = THREE.MathUtils.radToDeg(this.held.object3D.rotation.x);
        var rz = THREE.MathUtils.radToDeg(this.held.object3D.rotation.z);
        var isLevel = Math.abs(rx) < 1.5 && Math.abs(rz) < 1.5;
        this.readout.setAttribute('text', 'value',
          (isLevel ? '✓ LEVEL' : 'tilt  X:' + rx.toFixed(1) + '°  Z:' + rz.toFixed(1) + '°'));
        this.readout.setAttribute('visible', 'true');
        this.readoutTimer = 6;
      }
    } else if (this._toolMode === 2) {
      // ── HEIGHT MODE ──────────────────────────────────────────────────────
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
      // Spin still works in height mode
      if (Math.abs(this.stickX) > 0.15) {
        this.held.object3D.rotation.y += this.stickX * 0.02;
      }
    } else {
      // ── NORMAL MODE ──────────────────────────────────────────────────────
      // Spin — right stick X around building centre
      if (Math.abs(this.stickX) > 0.15) {
        this.held.object3D.rotation.y += this.stickX * 0.02;
        // Keep spinPivot in sync with building (centre-pivot, offset always 0)
        this._spinPivot.set(
          this.held.object3D.position.x, 0,
          this.held.object3D.position.z
        );
      }

      // Scale — right stick Y
      var adjusting = false;
      if (Math.abs(this.scaleY) > 0.15) {
        var oldSc  = this.held.object3D.scale.x;
        var ns     = Math.max(0.02, oldSc + this.scaleY * 0.002);
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

    var adjusting = this._tiltMode ? false : adjusting;

    // ── Live scale readout ────────────────────────────────────────────────
    if (this.readout) {
      if (adjusting) { this.readoutTimer = 90; }
      if (this.readoutTimer > 0) {
        this.readoutTimer--;
        if (this.frameCount % 6 === 0) {
          this.readout.setAttribute('text', 'value', 'scale  ' + this.held.object3D.scale.x.toFixed(3));
          this.readout.setAttribute('visible', 'true');
        }
      } else {
        this.readout.setAttribute('visible', 'false');
      }
    }

    } // end if (this.held)

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

    if (this.leftGripping && this.leftHovered && Math.abs(this.heightY) > 0.15) {
      this.leftHovered.object3D.position.y -= this.heightY * 0.007;
      if (this.readout && this.frameCount % 6 === 0) {
        var hy  = this.leftHovered.object3D.position.y.toFixed(2);
        var hlb = parseFloat(hy) >= 0 ? '+' + hy : hy;
        this.readout.setAttribute('text', 'value', 'floor offset  ' + hlb + ' m');
        this.readout.setAttribute('visible', 'true');
        this.readoutTimer = 60;
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
window._radialMenuOpen = false;
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
    self._leftCtrlEl = null;
    self._spawnCounts = {};

    this.el.sceneEl.addEventListener('loaded', function () {
      var leftCtrl = document.querySelector('[oculus-touch-controls*="left"]');
      self._leftCtrlEl = leftCtrl;
      self._buildWheel();

      if (leftCtrl) {
        leftCtrl.addEventListener('triggerdown', function () {
          self._open = true;
          window._radialMenuOpen = true;
          if (self._wheelEl) self._wheelEl.setAttribute('visible', 'true');
          self._highlighted = -1;
          self._refreshLabels();
        });

        leftCtrl.addEventListener('triggerup', function () {
          if (self._highlighted >= 0) {
            var items = self._items();
            var item  = items[self._page * 8 + self._highlighted];
            if (item) self._spawnItem(item);
          }
          self._open = false;
          window._radialMenuOpen = false;
          self._highlighted = -1;
          if (self._wheelEl) self._wheelEl.setAttribute('visible', 'false');
          if (self._nameLabel) self._nameLabel.setAttribute('text', 'value', '');
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

  _spawnItem: function (item) {
    var cam = document.querySelector('#cam');
    var rig = document.querySelector('#rig');
    if (!cam || !rig) return;

    // 2.5 m ahead in the direction the camera is facing, flattened to XZ
    var fwd  = new THREE.Vector3(0, 0, -1);
    var quat = new THREE.Quaternion();
    cam.object3D.getWorldQuaternion(quat);
    fwd.applyQuaternion(quat);
    fwd.y = 0;
    if (fwd.length() < 0.01) fwd.set(0, 0, -1);
    fwd.normalize();

    var rigPos = rig.object3D.position;
    var px = (rigPos.x + fwd.x * 2.5).toFixed(2);
    var pz = (rigPos.z + fwd.z * 2.5).toFixed(2);

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
      lbl.setAttribute('position', '0 8 0');
      lbl.setAttribute('align', 'center');
      lbl.setAttribute('color', '#ffee88');
      lbl.setAttribute('width', '12');
      lbl.setAttribute('material', 'shader:flat');
      entity.appendChild(lbl);
    }
  },

  tick: function () {
    if (!this._open || !this._leftCtrlEl) return;

    var ltc = this._leftCtrlEl.components['tracked-controls-webxr'] ||
              this._leftCtrlEl.components['tracked-controls'];
    var lgp = ltc && ltc.controller && ltc.controller.gamepad;
    if (!lgp || lgp.axes.length < 4) return;

    var sx  = lgp.axes[2];
    var sy  = lgp.axes[3];
    var mag = Math.sqrt(sx * sx + sy * sy);

    var newHighlight = -1;
    if (mag > 0.35) {
      // atan2(stickX, -stickY): 0 = up, goes clockwise — matches our slot layout
      var angle = Math.atan2(sx, -sy) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      newHighlight = Math.round(angle / 45) % 8;

      // Blank slot = treat as no selection
      var items = this._items();
      if (!items[this._page * 8 + newHighlight]) newHighlight = -1;
    }

    if (newHighlight === this._highlighted) return;
    this._highlighted = newHighlight;

    // Update visual highlight
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

    // Name label above wheel + description below
    if (this._nameLabel || this._descLabel) {
      var item = newHighlight >= 0 ? items[this._page * 8 + newHighlight] : null;
      if (this._nameLabel) this._nameLabel.setAttribute('text', 'value', item ? item.name : '');
      if (this._descLabel) this._descLabel.setAttribute('text', 'value', item ? (item.desc || '') : '');
    }
  }
});


// ── TOOL MENU ─────────────────────────────────────────────────────────────────
// Right thumbstick HOLD (when not holding a building) → 3-card panel opens
// Left stick ← / →  → move highlight between tools
// Release right thumbstick → activate highlighted tool & close
//
var _TOOLS = [
  {
    id: 0,
    name: 'NORMAL',
    sub: 'Spin & Scale',
    desc: 'R-stick left/right: rotate\nR-stick up/down: scale\nDefault mode for placing buildings.'
  },
  {
    id: 1,
    name: 'TILT',
    sub: 'Lean X / Z',
    desc: 'R-stick: tilt the building\nforward/back and side to side.\nGood for rubble or leaning walls.'
  },
  {
    id: 2,
    name: 'HEIGHT',
    sub: 'Raise & Lower',
    desc: 'R-stick up/down: lift or\nsink the building vertically.\nUse to float or embed objects.'
  }
];

window._toolMenuOpen = false;

AFRAME.registerComponent('tool-menu', {
  init: function () {
    var self = this;
    self._open        = false;
    self._highlighted = 0;
    self._panelEl     = null;
    self._cardEls     = [];
    self._descEl      = null;
    self._leftCtrlEl  = null;
    self._stickLocked = false;

    this.el.sceneEl.addEventListener('loaded', function () {
      self._buildPanel();
      self._bindControls();
    });
  },

  _bindControls: function () {
    var self = this;

    var rightCtrl = document.querySelector('[oculus-touch-controls*="right"]');
    var leftCtrl  = document.querySelector('[oculus-touch-controls*="left"]');

    if (!rightCtrl) {
      setTimeout(function () { self._bindControls(); }, 500);
      return;
    }

    self._leftCtrlEl = leftCtrl;

    // Right thumbstick press → open tool menu (only when not holding a building)
    rightCtrl.addEventListener('thumbstickdown', function () {
      var placer = self.el.sceneEl.components['vr-placer'];
      if (placer && placer.held) return;       // holding a building — let vr-placer handle it
      if (window._radialMenuOpen)   return;    // building wheel is open
      if (self._open)               return;

      self._open        = true;
      window._toolMenuOpen = true;
      var active = placer ? placer._toolMode : 0;
      self._highlighted = active;
      self._refresh();
      if (self._panelEl) self._panelEl.setAttribute('visible', 'true');
    });

    // Release → apply selection & close
    rightCtrl.addEventListener('thumbstickup', function () {
      if (!self._open) return;
      var placer = self.el.sceneEl.components['vr-placer'];
      if (placer) {
        placer._toolMode = self._highlighted;
        // Flash the readout with the new mode name
        var modeNames = ['NORMAL  (spin + scale)', 'TILT  (lean X / Z)', 'HEIGHT  (raise / lower)'];
        if (placer.readout) {
          placer.readout.setAttribute('text', 'value', modeNames[self._highlighted]);
          placer.readout.setAttribute('visible', 'true');
          placer.readoutTimer = 180;
        }
      }
      self._open = false;
      window._toolMenuOpen = false;
      if (self._panelEl) self._panelEl.setAttribute('visible', 'false');
    });

    // Left stick ← / → to move highlight while menu is open
    if (leftCtrl) {
      leftCtrl.addEventListener('thumbstickmoved', function (e) {
        if (!self._open) return;
        var sx = e.detail.x;
        if (sx < -0.5 && !self._stickLocked) {
          self._stickLocked = true;
          self._highlighted = Math.max(0, self._highlighted - 1);
          self._refresh();
        } else if (sx > 0.5 && !self._stickLocked) {
          self._stickLocked = true;
          self._highlighted = Math.min(2, self._highlighted + 1);
          self._refresh();
        } else if (Math.abs(sx) < 0.25) {
          self._stickLocked = false;
        }
      });
    }
  },

  _buildPanel: function () {
    var cam = document.querySelector('#cam');
    if (!cam) return;

    var panel = document.createElement('a-entity');
    panel.setAttribute('position', '0 0.06 -0.55');
    panel.setAttribute('visible', 'false');
    cam.appendChild(panel);
    this._panelEl = panel;

    // Header
    var header = document.createElement('a-text');
    header.setAttribute('value', 'SELECT TOOL');
    header.setAttribute('align', 'center');
    header.setAttribute('color', '#aabbcc');
    header.setAttribute('width', '0.55');
    header.setAttribute('position', '0 0.145 0.002');
    header.setAttribute('material', 'shader:flat');
    panel.appendChild(header);

    // Cards
    var CARD_W = 0.20, CARD_H = 0.17, GAP = 0.025;
    var startX  = -(CARD_W + GAP);   // 3 cards centred: -1, 0, +1

    for (var i = 0; i < 3; i++) {
      var cx   = startX + i * (CARD_W + GAP);
      var card = document.createElement('a-entity');
      card.setAttribute('position', cx + ' 0 0');
      panel.appendChild(card);
      this._cardEls.push(card);

      // Background
      var bg = document.createElement('a-plane');
      bg.setAttribute('width', CARD_W);
      bg.setAttribute('height', CARD_H);
      bg.setAttribute('material', 'color:#1a2030; opacity:0.92; transparent:true; shader:flat; side:double');
      card.appendChild(bg);
      card._bg = bg;

      // Tool name (big)
      var nameEl = document.createElement('a-text');
      nameEl.setAttribute('value', _TOOLS[i].name);
      nameEl.setAttribute('align', 'center');
      nameEl.setAttribute('baseline', 'center');
      nameEl.setAttribute('color', '#aabbcc');
      nameEl.setAttribute('width', '0.34');
      nameEl.setAttribute('position', '0 0.042 0.003');
      nameEl.setAttribute('material', 'shader:flat');
      card.appendChild(nameEl);
      card._nameEl = nameEl;

      // Sub label (small)
      var subEl = document.createElement('a-text');
      subEl.setAttribute('value', _TOOLS[i].sub);
      subEl.setAttribute('align', 'center');
      subEl.setAttribute('baseline', 'center');
      subEl.setAttribute('color', '#445566');
      subEl.setAttribute('width', '0.25');
      subEl.setAttribute('position', '0 0.008 0.003');
      subEl.setAttribute('material', 'shader:flat');
      card.appendChild(subEl);
      card._subEl = subEl;

      // Active dot (shows which tool is currently live)
      var dot = document.createElement('a-circle');
      dot.setAttribute('radius', '0.007');
      dot.setAttribute('position', '0 -0.055 0.003');
      dot.setAttribute('material', 'color:#4466aa; shader:flat; side:double');
      dot.setAttribute('visible', 'false');
      card.appendChild(dot);
      card._dot = dot;
    }

    // Description box below the cards
    var descBg = document.createElement('a-plane');
    descBg.setAttribute('width', '0.68');
    descBg.setAttribute('height', '0.09');
    descBg.setAttribute('position', '0 -0.145 0');
    descBg.setAttribute('material', 'color:#0d1020; opacity:0.90; transparent:true; shader:flat; side:double');
    panel.appendChild(descBg);

    var descEl = document.createElement('a-text');
    descEl.setAttribute('value', '');
    descEl.setAttribute('align', 'center');
    descEl.setAttribute('baseline', 'center');
    descEl.setAttribute('color', '#88aacc');
    descEl.setAttribute('width', '0.64');
    descEl.setAttribute('wrap-count', '42');
    descEl.setAttribute('position', '0 -0.145 0.003');
    descEl.setAttribute('material', 'shader:flat');
    panel.appendChild(descEl);
    this._descEl = descEl;

    // Hint line
    var hint = document.createElement('a-text');
    hint.setAttribute('value', 'L-stick ← → to pick  |  release R-stick to confirm');
    hint.setAttribute('align', 'center');
    hint.setAttribute('color', '#334455');
    hint.setAttribute('width', '0.62');
    hint.setAttribute('position', '0 -0.215 0.003');
    hint.setAttribute('material', 'shader:flat');
    panel.appendChild(hint);
  },

  _refresh: function () {
    var placer = this.el.sceneEl.components['vr-placer'];
    var active = placer ? placer._toolMode : -1;

    for (var i = 0; i < 3; i++) {
      var card = this._cardEls[i];
      if (!card) continue;
      var isHL  = (i === this._highlighted);
      var isAct = (i === active);

      if (card._bg) {
        card._bg.setAttribute('material',
          'color:' + (isHL ? '#2244aa' : '#1a2030') +
          '; opacity:' + (isHL ? '0.97' : '0.92') +
          '; transparent:true; shader:flat; side:double');
      }
      if (card._nameEl) card._nameEl.setAttribute('text', 'color', isHL ? '#ffffff' : '#556677');
      if (card._subEl)  card._subEl.setAttribute('text',  'color', isHL ? '#88aaff' : '#334455');
      if (card._dot) {
        card._dot.setAttribute('visible', isAct ? 'true' : 'false');
        if (isAct) card._dot.setAttribute('material',
          'color:' + (isHL ? '#ffffff' : '#4466aa') + '; shader:flat; side:double');
      }
    }

    if (this._descEl) {
      this._descEl.setAttribute('text', 'value', _TOOLS[this._highlighted].desc);
    }
  }
});
