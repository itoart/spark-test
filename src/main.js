import './style.css'
import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MOVE_SPEED = 5
const LOOK_SPEED = 1.1
const MOBILE_MOVE_SPEED_MULTIPLIER = 0.5
const MOBILE_LOOK_SPEED_MULTIPLIER = 0.3
const MOVE_ACCEL = 12
const MOVE_DECEL = 7
const EXTERNAL_MOVE_DAMPING = 7
const LOOK_INERTIA_DAMPING = 10
const LOOK_DRAG_IMPULSE = 0.022
const MIDDLE_DRAG_IMPULSE = 0.18
const WHEEL_IMPULSE = 0.08
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
const cpuCores = navigator.hardwareConcurrency ?? 4
const deviceMemoryGb = navigator.deviceMemory ?? 4
const isLowEndDevice = cpuCores <= 6 || deviceMemoryGb <= 4
const isAppleMobileLike =
  /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const LOD_SCALE_COARSE = isCoarsePointer
  ? isAppleMobileLike ? 0.9 : 0.8
  : isLowEndDevice ? 0.75 : 0.65
const LOD_SCALE_MOTION = isCoarsePointer
  ? isAppleMobileLike ? 0.95 : 0.9
  : isLowEndDevice ? 1.05 : 0.95
const LOD_SCALE_FINE = 6.0
const LOD_RAMP_SECONDS = 2.2
const LOD_MOTION_THRESHOLD = 0.015
const LOD_SETTLE_DELAY_SECONDS = 0.35
const LOD_TARGET_FPS = isCoarsePointer ? 30 : 60
const LOD_TARGET_FRAME_MS = 1000 / LOD_TARGET_FPS
const LOD_FRAME_EMA_ALPHA = 0.2
const LOD_SLOW_FRAME_MULTIPLIER = isCoarsePointer ? 1.45 : 1.08
const LOD_FAST_FRAME_MULTIPLIER = isCoarsePointer ? 0.8 : 0.88
const LOD_QUALITY_DROP_PER_SEC = isCoarsePointer ? 0.45 : 0.65
const LOD_QUALITY_RISE_PER_SEC = isCoarsePointer ? 0.2 : 0.3
const LOD_QUALITY_DROP_OVERSHOOT_CAP = 2
const LOD_QUALITY_RISE_HEADROOM_CAP = 1.6
const LOD_QUALITY_FLOOR = isCoarsePointer
  ? isAppleMobileLike ? 0.35 : 0.25
  : 0
const LOD_MOTION_LERP_ALPHA = 0.35
const LOD_SETTLED_LERP_ALPHA = 0.12
const IOS_SPLAT_INIT_RETRIES = isAppleMobileLike ? 1 : 0
const IOS_SPLAT_INIT_RETRY_DELAY_MS = 140
const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 2.2, 20)
const INITIAL_TARGET = new THREE.Vector3(0, 2.2, 0)
const ORBIT_RADIUS = INITIAL_CAMERA_POSITION.distanceTo(INITIAL_TARGET)
const SCENE_ALIGNMENT_ROTATION_X = Math.PI
const POSE_CAM_FIX_X = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI, 0, 0, 'XYZ')
)
const MOBILE_ARROW_IMAGE_URL = `${import.meta.env.BASE_URL}ui/arrow.png`
const SPLAT_EXTENSIONS = new Set([
  '.ply',
  '.sog',
  '.sogs',
  '.spz',
  '.splat',
  '.ksplat',
  '.json',
  '.zip',
])
const POSE_EXTENSIONS = new Set(['.txt', '.csv'])
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
])
const MARKER_DOUBLE_TAP_MS = 280
const MARKER_DOUBLE_TAP_DISTANCE_PX = 26
const IMAGE_VIEW_MIN_SCALE = 0.7
const IMAGE_VIEW_MAX_SCALE = 8
const MARKER_WARP_BACK_OFFSET = 2.5
const DEFAULT_INPUT_ACCEPT =
  '.ply,.sog,.sogs,.spz,.splat,.ksplat,.json,.zip,.txt,.csv,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff'
const INPUT_ACCEPT = isAppleMobileLike ? '*/*' : DEFAULT_INPUT_ACCEPT

const scene = new THREE.Scene()
scene.background = null

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
)
camera.position.copy(INITIAL_CAMERA_POSITION)

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setClearColor('#000000', 1)

function updateRendererViewport() {
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
}

updateRendererViewport()

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(2000, 48, 32)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      topColor: { value: new THREE.Color('#49b8ff') },
      skyColor: { value: new THREE.Color('#dff0ff') },
      horizonColor: { value: new THREE.Color('#ffffff') },
      lowColor: { value: new THREE.Color('#6f6f6f') },
      bottomColor: { value: new THREE.Color('#000000') },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 topColor;
      uniform vec3 skyColor;
      uniform vec3 horizonColor;
      uniform vec3 lowColor;
      uniform vec3 bottomColor;

      void main() {
        float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        // Gradient keys: black -> gray -> light horizon -> sky blue.
        vec3 color = bottomColor;
        color = mix(color, lowColor, smoothstep(0.08, 0.34, t));
        color = mix(color, horizonColor, smoothstep(0.34, 0.52, t));
        color = mix(color, skyColor, smoothstep(0.52, 0.72, t));
        color = mix(color, topColor, smoothstep(0.72, 1.00, t));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })

  const dome = new THREE.Mesh(geometry, material)
  dome.renderOrder = -1000
  return dome
}

const skyDome = createSkyDome()
scene.add(skyDome)

document.body.innerHTML = ''
document.body.appendChild(renderer.domElement)

const fileInput = document.createElement('input')
fileInput.type = 'file'
fileInput.accept = INPUT_ACCEPT
fileInput.multiple = true
fileInput.style.display = 'none'
document.body.appendChild(fileInput)

const directoryInput = document.createElement('input')
directoryInput.type = 'file'
directoryInput.multiple = true
directoryInput.accept = INPUT_ACCEPT
directoryInput.style.display = 'none'
directoryInput.setAttribute('webkitdirectory', '')
directoryInput.setAttribute('directory', '')
document.body.appendChild(directoryInput)

const controlsToggle = document.createElement('button')
controlsToggle.className = 'controls-toggle'
controlsToggle.type = 'button'
controlsToggle.innerHTML = '&#9776;'
controlsToggle.setAttribute('aria-label', 'Toggle controls help')
controlsToggle.setAttribute('aria-expanded', 'false')
document.body.appendChild(controlsToggle)

const overlay = document.createElement('div')
overlay.className = 'controls-hint is-collapsed'
overlay.innerHTML = `
  <div class="overlay-top">
    <div class="menu-load-wrap">
      <button class="menu-load-btn" type="button">Load</button>
      <div class="menu-load-choice is-hidden">
        <button class="menu-load-choice-btn" type="button" data-load-mode="files">Files</button>
        <button class="menu-load-choice-btn" type="button" data-load-mode="folder">Folder</button>
      </div>
    </div>
    <div class="marker-preview-box">
      <img class="marker-preview-img" alt="marker thumbnail" />
    </div>
  </div>
  <div class="marker-list">
    <strong>Markers</strong>
    <span class="marker-list-empty">No markers</span>
    <ul class="marker-list-items"></ul>
  </div>
`
document.body.appendChild(overlay)

controlsToggle.addEventListener('click', () => {
  overlay.classList.toggle('is-collapsed')
  controlsToggle.setAttribute(
    'aria-expanded',
    String(!overlay.classList.contains('is-collapsed'))
  )
})

const overlayTapState = {
  lastTapAt: 0,
  lastTapX: 0,
  lastTapY: 0,
}

overlay.addEventListener(
  'touchend',
  (event) => {
    if (event.changedTouches.length !== 1) {
      return
    }
    const touch = event.changedTouches[0]
    const now = Date.now()
    const dist = Math.hypot(
      touch.clientX - overlayTapState.lastTapX,
      touch.clientY - overlayTapState.lastTapY
    )
    if (now - overlayTapState.lastTapAt < 320 && dist <= 28) {
      // Prevent browser double-tap zoom inside hamburger UI.
      event.preventDefault()
    }
    overlayTapState.lastTapAt = now
    overlayTapState.lastTapX = touch.clientX
    overlayTapState.lastTapY = touch.clientY
  },
  { passive: false }
)

const lodStatus = document.createElement('div')
lodStatus.className = 'lod-status'
lodStatus.textContent = 'No splat loaded'
document.body.appendChild(lodStatus)

const loadingOverlay = document.createElement('div')
loadingOverlay.className = 'loading-overlay'
loadingOverlay.innerHTML = `
  <div class="loading-spinner" aria-hidden="true"></div>
  <div class="loading-text">Loading splat...</div>
`
document.body.appendChild(loadingOverlay)

const imageOverlay = document.createElement('div')
imageOverlay.className = 'image-overlay'
imageOverlay.innerHTML = `
  <div class="image-overlay-panel">
    <div class="image-overlay-header">
      <span class="image-overlay-title">Image Preview</span>
      <button class="image-overlay-close" type="button" aria-label="Close image">Close</button>
    </div>
    <div class="image-overlay-stage">
      <img class="image-overlay-img" alt="marker image" draggable="false" />
    </div>
  </div>
`
document.body.appendChild(imageOverlay)

const imageOverlayTitle = imageOverlay.querySelector('.image-overlay-title')
const imageOverlayClose = imageOverlay.querySelector('.image-overlay-close')
const imageOverlayStage = imageOverlay.querySelector('.image-overlay-stage')
const imageOverlayImg = imageOverlay.querySelector('.image-overlay-img')

const imageViewState = {
  open: false,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  panPointerId: null,
  panStartX: 0,
  panStartY: 0,
  panStartOffsetX: 0,
  panStartOffsetY: 0,
  pointers: new Map(),
  pinchStartDistance: 0,
  pinchStartScale: 1,
  pinchStartOffsetX: 0,
  pinchStartOffsetY: 0,
  pinchStartCenterX: 0,
  pinchStartCenterY: 0,
}

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.rotateSpeed = 0.5
controls.screenSpacePanning = true
controls.enablePan = false
controls.enableZoom = false
controls.minDistance = ORBIT_RADIUS
controls.maxDistance = ORBIT_RADIUS
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
controls.mouseButtons.RIGHT = THREE.MOUSE.NONE
controls.mouseButtons.MIDDLE = THREE.MOUSE.NONE
controls.target.copy(INITIAL_TARGET)
controls.enabled = !isCoarsePointer
controls.update()

renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

const keyState = {
  KeyW: false,
  KeyA: false,
  KeyS: false,
  KeyD: false,
  KeyQ: false,
  KeyE: false,
}

const movement = {
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  delta: new THREE.Vector3(),
}

const touchInput = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
}

const desktopLookState = {
  dragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
}
const desktopStrafeState = {
  dragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
}
const inertiaState = {
  moveInput: new THREE.Vector3(),
  externalVelocity: new THREE.Vector3(),
  lookVelocity: new THREE.Vector2(),
}

const lookState = {
  yaw: 0,
  pitch: 0,
}
const lodRampState = {
  active: false,
  settleTime: 0,
  controlsInteracting: false,
  forceCoarseUntil: 0,
  lastPos: new THREE.Vector3(),
  lastQuat: new THREE.Quaternion(),
}
const lodPerfState = {
  frameMs: LOD_TARGET_FRAME_MS,
  quality: 1,
}

const clock = new THREE.Clock()

function syncLookStateFromCamera() {
  const direction = new THREE.Vector3()
    .subVectors(controls.target, camera.position)
    .normalize()
  lookState.yaw = Math.atan2(direction.x, direction.z)
  lookState.pitch = Math.asin(
    THREE.MathUtils.clamp(direction.y, -0.999, 0.999)
  )
}

function applyLookDirection() {
  const cosPitch = Math.cos(lookState.pitch)
  const direction = new THREE.Vector3(
    Math.sin(lookState.yaw) * cosPitch,
    Math.sin(lookState.pitch),
    Math.cos(lookState.yaw) * cosPitch
  )

  controls.target.copy(camera.position).addScaledVector(direction, ORBIT_RADIUS)
}

function translateCameraAndTarget(offset) {
  camera.position.add(offset)
  controls.target.add(offset)
}

function expDamp(value, damping, deltaTime) {
  return value * Math.exp(-damping * deltaTime)
}

function resetView() {
  camera.position.copy(INITIAL_CAMERA_POSITION)
  controls.target.copy(INITIAL_TARGET)
  syncLookStateFromCamera()
  controls.update()
}

function nowSeconds() {
  return performance.now() * 0.001
}

function requestCoarseLod(seconds = LOD_SETTLE_DELAY_SECONDS) {
  lodRampState.forceCoarseUntil = Math.max(
    lodRampState.forceCoarseUntil,
    nowSeconds() + seconds
  )
}

function waitMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function clampLodQuality(value) {
  return THREE.MathUtils.clamp(value, LOD_QUALITY_FLOOR, 1)
}

function getLodRampTargetScale(settleTime) {
  const t = settleTime / LOD_RAMP_SECONDS
  return THREE.MathUtils.lerp(LOD_SCALE_COARSE, LOD_SCALE_FINE, t)
}

function getBudgetedLodScale(targetScale) {
  return THREE.MathUtils.lerp(LOD_SCALE_COARSE, targetScale, lodPerfState.quality)
}

syncLookStateFromCamera()

if (!isCoarsePointer) {
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (imageViewState.open) {
      return
    }
    if (event.button === 2) {
      desktopLookState.dragging = true
      desktopLookState.pointerId = event.pointerId
      desktopLookState.lastX = event.clientX
      desktopLookState.lastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
      requestCoarseLod()
      event.preventDefault()
      return
    }

    if (event.button === 1) {
      desktopStrafeState.dragging = true
      desktopStrafeState.pointerId = event.pointerId
      desktopStrafeState.lastX = event.clientX
      desktopStrafeState.lastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
      requestCoarseLod()
      event.preventDefault()
      return
    }
  })

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (imageViewState.open) {
      return
    }
    if (desktopLookState.dragging && event.pointerId === desktopLookState.pointerId) {
      const dx = event.clientX - desktopLookState.lastX
      const dy = event.clientY - desktopLookState.lastY
      desktopLookState.lastX = event.clientX
      desktopLookState.lastY = event.clientY

      lookState.yaw -= dx * 0.0018
      lookState.pitch -= dy * 0.0018
      lookState.pitch = THREE.MathUtils.clamp(lookState.pitch, -1.45, 1.45)
      inertiaState.lookVelocity.x += -dx * LOOK_DRAG_IMPULSE
      inertiaState.lookVelocity.y += -dy * LOOK_DRAG_IMPULSE
      applyLookDirection()
      requestCoarseLod()
      event.preventDefault()
    }

    if (desktopStrafeState.dragging && event.pointerId === desktopStrafeState.pointerId) {
      const dx = event.clientX - desktopStrafeState.lastX
      const dy = event.clientY - desktopStrafeState.lastY
      desktopStrafeState.lastX = event.clientX
      desktopStrafeState.lastY = event.clientY

      movement.forward.subVectors(controls.target, camera.position)
      if (movement.forward.lengthSq() < 1e-8) {
        movement.forward.set(0, 0, -1)
      } else {
        movement.forward.normalize()
      }
      movement.right.crossVectors(movement.forward, camera.up)
      if (movement.right.lengthSq() < 1e-8) {
        movement.right.set(1, 0, 0)
      } else {
        movement.right.normalize()
      }
      movement.up.copy(camera.up).normalize()
      inertiaState.externalVelocity.addScaledVector(
        movement.right,
        -dx * MIDDLE_DRAG_IMPULSE
      )
      inertiaState.externalVelocity.addScaledVector(
        movement.up,
        dy * MIDDLE_DRAG_IMPULSE
      )
      requestCoarseLod()
      event.preventDefault()
    }
  })

  const endDesktopLookDrag = (event) => {
    if (desktopLookState.dragging && event.pointerId === desktopLookState.pointerId) {
      desktopLookState.dragging = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      desktopLookState.pointerId = null
    }
    if (desktopStrafeState.dragging && event.pointerId === desktopStrafeState.pointerId) {
      desktopStrafeState.dragging = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      desktopStrafeState.pointerId = null
    }
  }

  renderer.domElement.addEventListener('pointerup', endDesktopLookDrag)
  renderer.domElement.addEventListener('pointercancel', endDesktopLookDrag)

  renderer.domElement.addEventListener(
    'wheel',
    (event) => {
      if (imageViewState.open) {
        return
      }
      movement.forward.subVectors(controls.target, camera.position)
      if (movement.forward.lengthSq() < 1e-8) {
        movement.forward.set(0, 0, -1)
      } else {
        movement.forward.normalize()
      }
      inertiaState.externalVelocity.addScaledVector(
        movement.forward,
        -event.deltaY * WHEEL_IMPULSE
      )
      requestCoarseLod()
      event.preventDefault()
    },
    { passive: false }
  )
}

controls.addEventListener('start', () => {
  lodRampState.controlsInteracting = true
  requestCoarseLod(1.0)
})
controls.addEventListener('end', () => {
  lodRampState.controlsInteracting = false
  requestCoarseLod()
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && imageViewState.open) {
    closeImageOverlay()
    event.preventDefault()
    return
  }

  if (imageViewState.open) {
    event.preventDefault()
    return
  }

  if (event.code === 'KeyR') {
    resetView()
    event.preventDefault()
    return
  }

  if (!(event.code in keyState)) {
    return
  }

  keyState[event.code] = true
  requestCoarseLod()
  event.preventDefault()
})

window.addEventListener('keyup', (event) => {
  if (imageViewState.open) {
    event.preventDefault()
    return
  }
  if (!(event.code in keyState)) {
    return
  }

  keyState[event.code] = false
  requestCoarseLod()
  event.preventDefault()
})

window.addEventListener('blur', () => {
  for (const code of Object.keys(keyState)) {
    keyState[code] = false
  }
})

function setControlKey(code, pressed) {
  if (imageViewState.open) {
    return
  }
  if (!(code in keyState)) {
    return
  }
  keyState[code] = pressed
  requestCoarseLod()
}

function bindVirtualStick({ root, base, stick, setX, setY }) {
  const getMaxRadius = () => Math.max(24, base.clientWidth * 0.36)

  const resetStick = () => {
    setX(0)
    setY(0)
    stick.style.transform = 'translate(-50%, -50%)'
    root.classList.remove('is-active')
  }

  const updateStick = (event) => {
    const rect = base.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = event.clientX - cx
    const dy = event.clientY - cy
    const maxRadius = getMaxRadius()
    const distance = Math.min(maxRadius, Math.hypot(dx, dy))
    const angle = Math.atan2(dy, dx)
    const clampedX = Math.cos(angle) * distance
    const clampedY = Math.sin(angle) * distance

    setX(clampedX / maxRadius)
    setY(clampedY / maxRadius)
    stick.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`
  }

  base.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    root.classList.add('is-active')
    base.setPointerCapture(event.pointerId)
    updateStick(event)
  })
  base.addEventListener('pointermove', (event) => {
    if (!root.classList.contains('is-active')) {
      return
    }
    updateStick(event)
  })
  base.addEventListener('pointerup', (event) => {
    base.releasePointerCapture(event.pointerId)
    resetStick()
  })
  base.addEventListener('pointercancel', resetStick)
}

function createArrowOverlayDataUrl(imageUrl) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(imageUrl)
        return
      }

      context.drawImage(image, 0, 0)
      const imgData = context.getImageData(0, 0, canvas.width, canvas.height)
      const data = imgData.data
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const luminance = (r + g + b) / 3
        // white -> transparent, black -> opaque black
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255 - luminance
      }

      context.putImageData(imgData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => resolve(imageUrl)
    image.src = imageUrl
  })
}

function createMobileControls() {
  if (!isCoarsePointer) {
    return
  }

  const mobileControls = document.createElement('div')
  mobileControls.className = 'mobile-controls'
  mobileControls.innerHTML = `
    <div class="mobile-move">
      <div class="mobile-stick-label">MOVE</div>
      <div class="mobile-stick-base" data-stick="move">
        <div class="mobile-stick"></div>
      </div>
    </div>
    <div class="mobile-vertical">
      <button class="mobile-tri mobile-tri-up" data-key="KeyE" aria-label="UP">
        <img class="mobile-tri-icon" src="${MOBILE_ARROW_IMAGE_URL}" alt="" aria-hidden="true" />
      </button>
      <button class="mobile-tri mobile-tri-down" data-key="KeyQ" aria-label="DOWN">
        <img class="mobile-tri-icon" src="${MOBILE_ARROW_IMAGE_URL}" alt="" aria-hidden="true" />
      </button>
    </div>
    <div class="mobile-look">
      <div class="mobile-stick-label">LOOK</div>
      <div class="mobile-stick-base" data-stick="look">
        <div class="mobile-stick"></div>
      </div>
    </div>
  `

  const moveRoot = mobileControls.querySelector('.mobile-move')
  const moveBase = mobileControls.querySelector('[data-stick="move"]')
  const moveStick = moveBase.querySelector('.mobile-stick')
  bindVirtualStick({
    root: moveRoot,
    base: moveBase,
    stick: moveStick,
    setX: (x) => {
      touchInput.moveX = x
    },
    setY: (y) => {
      touchInput.moveY = y
    },
  })

  const lookRoot = mobileControls.querySelector('.mobile-look')
  const lookBase = mobileControls.querySelector('[data-stick="look"]')
  const lookStick = lookBase.querySelector('.mobile-stick')
  bindVirtualStick({
    root: lookRoot,
    base: lookBase,
    stick: lookStick,
    setX: (x) => {
      touchInput.lookX = x
    },
    setY: (y) => {
      touchInput.lookY = y
    },
  })

  createArrowOverlayDataUrl(MOBILE_ARROW_IMAGE_URL).then((resolvedUrl) => {
    for (const icon of mobileControls.querySelectorAll('.mobile-tri-icon')) {
      icon.src = resolvedUrl
    }
  })

  const release = (button) => {
    button.classList.remove('is-active')
    setControlKey(button.dataset.key, false)
  }

  for (const button of mobileControls.querySelectorAll('button[data-key]')) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      button.classList.add('is-active')
      setControlKey(button.dataset.key, true)
    })
    button.addEventListener('pointerup', () => release(button))
    button.addEventListener('pointercancel', () => release(button))
    button.addEventListener('pointerleave', () => release(button))
  }

  let lastTapAt = 0
  let lastTapX = 0
  let lastTapY = 0
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (imageViewState.open) {
      return
    }
    if (!event.isPrimary) {
      return
    }
    const now = Date.now()
    const dist = Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY)
    if (now - lastTapAt < MARKER_DOUBLE_TAP_MS && dist <= MARKER_DOUBLE_TAP_DISTANCE_PX) {
      handleMarkerOpenAtPoint(event.clientX, event.clientY, true)
    }
    lastTapAt = now
    lastTapX = event.clientX
    lastTapY = event.clientY
  })

  document.body.appendChild(mobileControls)
}

createMobileControls()

renderer.domElement.addEventListener('dblclick', (event) => {
  handleMarkerOpenAtPoint(event.clientX, event.clientY, false)
})

imageOverlayClose?.addEventListener('click', () => {
  closeImageOverlay()
})

imageOverlay.addEventListener('click', (event) => {
  if (event.target === imageOverlay) {
    closeImageOverlay()
  }
})

function getStageRelativePoint(clientX, clientY) {
  if (!imageOverlayStage) {
    return { x: 0, y: 0 }
  }
  const rect = imageOverlayStage.getBoundingClientRect()
  return {
    x: clientX - (rect.left + rect.width * 0.5),
    y: clientY - (rect.top + rect.height * 0.5),
  }
}

function getPinchInfo() {
  const points = Array.from(imageViewState.pointers.values())
  if (points.length < 2) {
    return null
  }
  const [a, b] = points
  const dx = b.x - a.x
  const dy = b.y - a.y
  return {
    distance: Math.hypot(dx, dy),
    centerX: (a.x + b.x) * 0.5,
    centerY: (a.y + b.y) * 0.5,
  }
}

function beginPinch() {
  const pinch = getPinchInfo()
  if (!pinch) {
    return
  }
  imageViewState.panPointerId = null
  imageViewState.pinchStartDistance = pinch.distance
  imageViewState.pinchStartScale = imageViewState.scale
  imageViewState.pinchStartOffsetX = imageViewState.offsetX
  imageViewState.pinchStartOffsetY = imageViewState.offsetY
  imageViewState.pinchStartCenterX = pinch.centerX
  imageViewState.pinchStartCenterY = pinch.centerY
}

imageOverlayStage?.addEventListener(
  'wheel',
  (event) => {
    if (!imageViewState.open) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const point = getStageRelativePoint(event.clientX, event.clientY)
    const prevScale = imageViewState.scale
    const nextScale = THREE.MathUtils.clamp(
      prevScale * Math.exp(-event.deltaY * 0.0012),
      IMAGE_VIEW_MIN_SCALE,
      IMAGE_VIEW_MAX_SCALE
    )
    if (Math.abs(nextScale - prevScale) < 1e-4) {
      return
    }
    imageViewState.offsetX =
      point.x - ((point.x - imageViewState.offsetX) / prevScale) * nextScale
    imageViewState.offsetY =
      point.y - ((point.y - imageViewState.offsetY) / prevScale) * nextScale
    imageViewState.scale = nextScale
    applyImageViewTransform()
  },
  { passive: false }
)

for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
  imageOverlayStage?.addEventListener(eventName, (event) => {
    if (!imageViewState.open) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const pointerEvent = event

    if (eventName === 'pointerdown') {
      imageOverlayStage.setPointerCapture(pointerEvent.pointerId)
      imageViewState.pointers.set(pointerEvent.pointerId, {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      })
      if (imageViewState.pointers.size === 1) {
        imageViewState.panPointerId = pointerEvent.pointerId
        imageViewState.panStartX = pointerEvent.clientX
        imageViewState.panStartY = pointerEvent.clientY
        imageViewState.panStartOffsetX = imageViewState.offsetX
        imageViewState.panStartOffsetY = imageViewState.offsetY
      } else if (imageViewState.pointers.size >= 2) {
        beginPinch()
      }
      return
    }

    if (!imageViewState.pointers.has(pointerEvent.pointerId)) {
      return
    }

    if (eventName === 'pointermove') {
      imageViewState.pointers.set(pointerEvent.pointerId, {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      })

      if (imageViewState.pointers.size >= 2) {
        const pinch = getPinchInfo()
        if (!pinch || imageViewState.pinchStartDistance <= 0) {
          return
        }
        const pinchScale = pinch.distance / imageViewState.pinchStartDistance
        imageViewState.scale = THREE.MathUtils.clamp(
          imageViewState.pinchStartScale * pinchScale,
          IMAGE_VIEW_MIN_SCALE,
          IMAGE_VIEW_MAX_SCALE
        )
        imageViewState.offsetX =
          imageViewState.pinchStartOffsetX + pinch.centerX - imageViewState.pinchStartCenterX
        imageViewState.offsetY =
          imageViewState.pinchStartOffsetY + pinch.centerY - imageViewState.pinchStartCenterY
        applyImageViewTransform()
        return
      }

      if (imageViewState.panPointerId === pointerEvent.pointerId) {
        imageViewState.offsetX =
          imageViewState.panStartOffsetX + (pointerEvent.clientX - imageViewState.panStartX)
        imageViewState.offsetY =
          imageViewState.panStartOffsetY + (pointerEvent.clientY - imageViewState.panStartY)
        applyImageViewTransform()
      }
      return
    }

    imageViewState.pointers.delete(pointerEvent.pointerId)
    if (imageOverlayStage.hasPointerCapture(pointerEvent.pointerId)) {
      imageOverlayStage.releasePointerCapture(pointerEvent.pointerId)
    }

    if (imageViewState.pointers.size >= 2) {
      beginPinch()
      return
    }

    if (imageViewState.pointers.size === 1) {
      const [remainingId, point] = imageViewState.pointers.entries().next().value
      imageViewState.panPointerId = remainingId
      imageViewState.panStartX = point.x
      imageViewState.panStartY = point.y
      imageViewState.panStartOffsetX = imageViewState.offsetX
      imageViewState.panStartOffsetY = imageViewState.offsetY
      return
    }

    imageViewState.panPointerId = null
  })
}

const spark = new SparkRenderer({
  renderer,
  enableLod: true,
  maxStdDev: Math.sqrt(isCoarsePointer ? 4 : 5),
  maxPixelRadius: isCoarsePointer ? (isAppleMobileLike ? 256 : 224) : 256,
  minPixelRadius: isCoarsePointer ? 0.6 : 0.4,
  minAlpha: isCoarsePointer ? 0.01 : 0.006,
  minSortIntervalMs: isCoarsePointer ? (isAppleMobileLike ? 12 : 16) : isLowEndDevice ? 24 : 12,
  lodSplatScale: LOD_SCALE_COARSE,
  behindFoveate: 1.0,
  numLodFetchers: isCoarsePointer ? (isAppleMobileLike ? 4 : 3) : 4,
})
scene.add(spark)

let activeSplat = null
const poseMarkersRoot = new THREE.Group()
poseMarkersRoot.rotation.x = SCENE_ALIGNMENT_ROTATION_X
scene.add(poseMarkersRoot)

function clearPoseMarkers() {
  hideMarkerPreview()
  markerListRegistry.clear()
  for (const child of [...poseMarkersRoot.children]) {
    child.traverse((node) => {
      if (node.geometry) {
        node.geometry.dispose()
      }
      if (node.material) {
        if (Array.isArray(node.material)) {
          for (const material of node.material) {
            material.dispose()
          }
        } else {
          node.material.dispose()
        }
      }
    })
    poseMarkersRoot.remove(child)
  }
}

const markerListItems = overlay.querySelector('.marker-list-items')
const markerListEmpty = overlay.querySelector('.marker-list-empty')
const loadChoice = overlay.querySelector('.menu-load-choice')
const markerPreview = overlay.querySelector('.marker-preview-box')
const markerPreviewImg = markerPreview.querySelector('.marker-preview-img')
const markerRaycaster = new THREE.Raycaster()
const markerPointerNdc = new THREE.Vector2()
markerRaycaster.params.Line.threshold = 0.14
const markerListRegistry = new Map()
let markerListIdSeed = 0
let markerPreviewPinned = false

const imageStore = {
  byFullName: new Map(),
  byNoExtName: new Map(),
  objectUrls: new Set(),
}

function getLowerBaseName(rawName) {
  const normalized = rawName.replace(/\\/g, '/').toLowerCase()
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? ''
}

function removeFileExtension(name) {
  return name.replace(/\.[^.]+$/, '')
}

function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) {
    return ''
  }
  return fileName.slice(lastDot).toLowerCase()
}

function updateMarkerList(names) {
  if (!markerListItems || !markerListEmpty) {
    return
  }

  markerListRegistry.clear()
  markerListItems.innerHTML = ''
  if (names.length === 0) {
    markerListEmpty.textContent = 'No markers'
    markerListEmpty.classList.remove('is-hidden')
    return
  }

  markerListEmpty.classList.add('is-hidden')
  for (const marker of names) {
    const markerId = `marker-${markerListIdSeed++}`
    markerListRegistry.set(markerId, marker)
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'marker-list-link'
    button.dataset.markerId = markerId
    button.textContent = marker.label
    item.appendChild(button)
    markerListItems.appendChild(item)
  }
}

function hideMarkerPreview() {
  if (markerPreviewImg) {
    markerPreviewImg.removeAttribute('src')
  }
  markerPreview.classList.remove('is-active')
  markerPreviewPinned = false
}

function setMarkerPreviewReady(ready) {
  markerPreview.classList.toggle('is-ready', ready)
}

function showMarkerPreview(markerData, { pinned = false } = {}) {
  if (!markerData?.imageEntry || !markerPreviewImg) {
    hideMarkerPreview()
    return
  }
  markerPreviewImg.src = markerData.imageEntry.objectUrl
  markerPreview.classList.add('is-active')
  markerPreviewPinned = pinned
}

function warpToMarker(markerData) {
  if (!markerData) {
    return
  }
  const markerObject = markerData.markerObject
  const worldPosition = new THREE.Vector3()
  const worldQuaternion = new THREE.Quaternion()

  if (markerObject) {
    markerObject.getWorldPosition(worldPosition)
    markerObject.getWorldQuaternion(worldQuaternion)
  } else if (markerData.position && markerData.quaternion) {
    worldPosition.copy(markerData.position)
    worldQuaternion.copy(markerData.quaternion)
  } else {
    return
  }

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuaternion)
  camera.position.copy(worldPosition).addScaledVector(forward, -MARKER_WARP_BACK_OFFSET)
  controls.target
    .copy(worldPosition)
    .addScaledVector(forward, ORBIT_RADIUS - MARKER_WARP_BACK_OFFSET)
  syncLookStateFromCamera()
  controls.update()
  requestCoarseLod(1.0)
}

function clearImageStore() {
  for (const url of imageStore.objectUrls) {
    URL.revokeObjectURL(url)
  }
  imageStore.objectUrls.clear()
  imageStore.byFullName.clear()
  imageStore.byNoExtName.clear()
}

function buildImageStore(imageFiles) {
  clearImageStore()
  for (const file of imageFiles) {
    const fullName = getLowerBaseName(file.name)
    const noExtName = removeFileExtension(fullName)
    const objectUrl = URL.createObjectURL(file)
    const entry = { name: file.name, objectUrl }
    imageStore.objectUrls.add(objectUrl)
    if (!imageStore.byFullName.has(fullName)) {
      imageStore.byFullName.set(fullName, entry)
    }
    if (!imageStore.byNoExtName.has(noExtName)) {
      imageStore.byNoExtName.set(noExtName, entry)
    }
  }
}

function getImageEntryForPoseName(poseName) {
  if (imageStore.byFullName.size === 0) {
    return null
  }
  const fullName = getLowerBaseName(poseName)
  const noExtName = removeFileExtension(fullName)
  return (
    imageStore.byFullName.get(fullName) ?? imageStore.byNoExtName.get(noExtName) ?? null
  )
}

function markerDataFromObject(object) {
  let current = object
  while (current) {
    if (current.userData?.markerData) {
      return current.userData.markerData
    }
    if (current === poseMarkersRoot) {
      break
    }
    current = current.parent
  }
  return null
}

function getMarkerDataAtClientPoint(clientX, clientY) {
  if (poseMarkersRoot.children.length === 0) {
    return null
  }
  const rect = renderer.domElement.getBoundingClientRect()
  markerPointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  markerPointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  markerRaycaster.setFromCamera(markerPointerNdc, camera)
  const hits = markerRaycaster.intersectObjects(poseMarkersRoot.children, true)
  for (const hit of hits) {
    const markerData = markerDataFromObject(hit.object)
    if (markerData) {
      return markerData
    }
  }
  return null
}

function applyImageViewTransform() {
  if (!imageOverlayImg) {
    return
  }
  imageOverlayImg.style.transform =
    `translate(calc(-50% + ${imageViewState.offsetX}px), calc(-50% + ${imageViewState.offsetY}px)) ` +
    `scale(${imageViewState.scale})`
}

function resetImageViewTransform() {
  imageViewState.scale = 1
  imageViewState.offsetX = 0
  imageViewState.offsetY = 0
  imageViewState.panPointerId = null
  imageViewState.pointers.clear()
  applyImageViewTransform()
}

function clearInputState() {
  for (const code of Object.keys(keyState)) {
    keyState[code] = false
  }
  touchInput.moveX = 0
  touchInput.moveY = 0
  touchInput.lookX = 0
  touchInput.lookY = 0
  inertiaState.moveInput.set(0, 0, 0)
  inertiaState.externalVelocity.set(0, 0, 0)
  inertiaState.lookVelocity.set(0, 0)
}

function openImageOverlay(markerData) {
  if (!markerData?.imageEntry || !imageOverlayImg || !imageOverlayTitle) {
    return
  }
  hideMarkerPreview()
  imageOverlayImg.src = markerData.imageEntry.objectUrl
  imageOverlayTitle.textContent = markerData.imageEntry.name
  imageOverlay.classList.add('is-active')
  imageViewState.open = true
  resetImageViewTransform()
  clearInputState()
}

function closeImageOverlay() {
  if (!imageOverlayImg) {
    return
  }
  imageOverlay.classList.remove('is-active')
  imageViewState.open = false
  imageOverlayImg.removeAttribute('src')
  resetImageViewTransform()
}

function handleMarkerOpenAtPoint(clientX, clientY, resetOnMiss = false) {
  if (imageViewState.open) {
    return
  }
  const markerData = getMarkerDataAtClientPoint(clientX, clientY)
  if (markerData?.imageEntry) {
    openImageOverlay(markerData)
    return
  }
  if (resetOnMiss) {
    resetView()
  }
}

function parsePosesText(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  const poses = []
  for (const row of rows) {
    const parts = row.split(',').map((value) => value.trim())
    if (parts.length < 8) {
      continue
    }
    const [name, x, y, z, qw, qx, qy, qz] = parts
    const nums = [x, y, z, qw, qx, qy, qz].map((value) => Number(value))
    if (nums.some((value) => !Number.isFinite(value))) {
      continue
    }
    poses.push({
      name,
      // Match PlayCanvas mapping: (x, y, alt) -> (x, -alt, y)
      position: new THREE.Vector3(nums[0], -nums[2], nums[1]),
      quaternion: new THREE.Quaternion(nums[4], nums[5], nums[6], nums[3])
        .invert()
        .multiply(POSE_CAM_FIX_X),
    })
  }
  return poses
}

function createPoseMarker(pose, markerData) {
  const marker = new THREE.Group()
  marker.position.copy(pose.position)
  marker.quaternion.copy(pose.quaternion)
  markerData.markerObject = marker
  marker.userData.markerData = markerData

  const size = 0.22
  const length = 0.42
  const apex = new THREE.Vector3(0, 0, 0)
  const c1 = new THREE.Vector3(-size, size, -length)
  const c2 = new THREE.Vector3(size, size, -length)
  const c3 = new THREE.Vector3(size, -size, -length)
  const c4 = new THREE.Vector3(-size, -size, -length)

  const sideGeometry = new THREE.BufferGeometry()
  sideGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        apex.x, apex.y, apex.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z,
        apex.x, apex.y, apex.z, c2.x, c2.y, c2.z, c3.x, c3.y, c3.z,
        apex.x, apex.y, apex.z, c3.x, c3.y, c3.z, c4.x, c4.y, c4.z,
        apex.x, apex.y, apex.z, c4.x, c4.y, c4.z, c1.x, c1.y, c1.z,
      ]),
      3
    )
  )
  sideGeometry.computeVertexNormals()

  const sideMesh = new THREE.Mesh(
    sideGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x2ac3ff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.28,
      side: THREE.FrontSide,
    })
  )
  sideMesh.renderOrder = 10
  marker.add(sideMesh)

  const frontFaceGeometry = new THREE.BufferGeometry()
  frontFaceGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        c1.x, c1.y, c1.z, c2.x, c2.y, c2.z, c3.x, c3.y, c3.z,
        c1.x, c1.y, c1.z, c3.x, c3.y, c3.z, c4.x, c4.y, c4.z,
      ]),
      3
    )
  )
  frontFaceGeometry.computeVertexNormals()
  const frontFaceMesh = new THREE.Mesh(
    frontFaceGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xff8b3d,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    })
  )
  frontFaceMesh.renderOrder = 10
  marker.add(frontFaceMesh)

  const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
    apex, c1, apex, c2, apex, c3, apex, c4, c1, c2, c2, c3, c3, c4, c4, c1,
  ])
  const edges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: 0x2ac3ff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    })
  )
  edges.renderOrder = 11
  marker.add(edges)

  return marker
}

async function loadPoseFile(file, imageFiles = []) {
  lodStatus.classList.remove('is-hidden')
  lodStatus.textContent = `Loading poses: ${file.name}`
  try {
    const text = await file.text()
    const poses = parsePosesText(text)
    if (poses.length === 0) {
      lodStatus.textContent = 'Pose file parse failed: no valid rows'
      return
    }

    buildImageStore(imageFiles)
    const filteredPoses = poses.filter((pose) => {
      if (imageStore.byFullName.size === 0) {
        return true
      }
      return Boolean(getImageEntryForPoseName(pose.name))
    })
    const markerEntries = []

    clearPoseMarkers()
    for (const pose of filteredPoses) {
      const imageEntry = getImageEntryForPoseName(pose.name)
      const markerData = {
        poseName: pose.name,
        imageEntry,
        position: pose.position.clone(),
        quaternion: pose.quaternion.clone(),
        markerObject: null,
      }
      markerData.label = imageEntry?.name ?? getLowerBaseName(pose.name)
      markerEntries.push(markerData)
      poseMarkersRoot.add(
        createPoseMarker(pose, markerData)
      )
    }
    updateMarkerList(markerEntries)

    lodStatus.textContent = `Loaded poses: ${filteredPoses.length}/${poses.length}`
    window.setTimeout(() => {
      lodStatus.classList.add('is-hidden')
    }, 1800)
  } catch (error) {
    console.error('Failed to load poses', error)
    const reason = error instanceof Error ? error.message : String(error)
    lodStatus.textContent = `Pose file load failed: ${reason.slice(0, 64)}`
  }
}

async function createInitializedSplatMesh(fileBytes, fileName, useLod) {
  const mesh = new SplatMesh({
    fileBytes,
    fileName,
    lod: useLod,
    nonLod: true,
    enableLod: false,
    behindFoveate: 1.0,
  })
  try {
    await mesh.initialized
    return mesh
  } catch (error) {
    mesh.dispose?.()
    throw error
  }
}

async function createInitializedSplatMeshWithRetry(fileBytes, fileName, useLod) {
  let lastError = null
  for (let attempt = 0; attempt <= IOS_SPLAT_INIT_RETRIES; attempt += 1) {
    try {
      return await createInitializedSplatMesh(fileBytes, fileName, useLod)
    } catch (error) {
      lastError = error
      if (attempt < IOS_SPLAT_INIT_RETRIES) {
        await waitMs(IOS_SPLAT_INIT_RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }
  throw lastError
}

async function loadLocalSplat(file) {
  const loadingText = loadingOverlay.querySelector('.loading-text')
  if (loadingText) {
    loadingText.textContent = `Loading ${file.name}...`
  }
  loadingOverlay.classList.add('is-active')
  lodStatus.classList.remove('is-hidden')
  lodStatus.textContent = `Loading local file: ${file.name}`

  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    let nextSplat = null
    let loadedWithLod = true
    try {
      nextSplat = await createInitializedSplatMeshWithRetry(fileBytes, file.name, true)
    } catch (error) {
      if (!isAppleMobileLike) {
        throw error
      }
      console.warn('LoD init unstable on iPad, retrying stable mode', error)
      lodStatus.textContent = 'Retrying stable iPad mode...'
      loadedWithLod = false
      nextSplat = await createInitializedSplatMeshWithRetry(fileBytes, file.name, false)
    }

    nextSplat.rotation.x = SCENE_ALIGNMENT_ROTATION_X
    scene.add(nextSplat)

    const prevSplat = activeSplat
    activeSplat = nextSplat
    if (prevSplat) {
      scene.remove(prevSplat)
      prevSplat.dispose()
    }

    if (loadedWithLod) {
      await initializeLod(activeSplat)
    } else {
      lodRampState.active = false
      lodStatus.textContent = `Loaded (stable mode): ${file.name}`
    }
    resetView()
    if (loadedWithLod) {
      lodStatus.textContent = `Loaded: ${file.name}`
    }
    window.setTimeout(() => {
      lodStatus.classList.add('is-hidden')
    }, 1400)
  } catch (error) {
    console.error('Failed to load local splat', error)
    const reason = error instanceof Error ? error.message : String(error)
    lodStatus.textContent = `Local file load failed: ${reason.slice(0, 64)}`
  } finally {
    loadingOverlay.classList.remove('is-active')
  }
}

function classifyFiles(files) {
  const splatFiles = []
  const poseFiles = []
  const imageFiles = []

  for (const file of files) {
    const ext = getFileExtension(file.name)
    if (SPLAT_EXTENSIONS.has(ext)) {
      splatFiles.push(file)
    } else if (POSE_EXTENSIONS.has(ext)) {
      poseFiles.push(file)
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      imageFiles.push(file)
    }
  }
  return { splatFiles, poseFiles, imageFiles }
}

async function loadSelection(fileList) {
  const files = Array.from(fileList ?? [])
  if (files.length === 0) {
    return
  }
  closeImageOverlay()

  const { splatFiles, poseFiles, imageFiles } = classifyFiles(files)
  setMarkerPreviewReady(splatFiles.length > 0 || poseFiles.length > 0)
  if (splatFiles.length > 0) {
    await loadLocalSplat(splatFiles[0])
  }
  if (poseFiles.length > 0) {
    await loadPoseFile(poseFiles[0], imageFiles)
  }

  if (splatFiles.length === 0 && poseFiles.length === 0) {
    lodStatus.classList.remove('is-hidden')
    lodStatus.textContent = 'No splat/pose file found in selection'
  }
}

const menuLoadButton = overlay.querySelector('.menu-load-btn')
menuLoadButton?.addEventListener('click', () => {
  loadChoice?.classList.toggle('is-hidden')
})

for (const button of overlay.querySelectorAll('.menu-load-choice-btn')) {
  button.addEventListener('click', () => {
    const mode = button.getAttribute('data-load-mode')
    loadChoice?.classList.add('is-hidden')
    if (mode === 'folder') {
      directoryInput.value = ''
      directoryInput.click()
      return
    }
    fileInput.value = ''
    fileInput.click()
  })
}

document.addEventListener('click', (event) => {
  if (!loadChoice || !menuLoadButton) {
    return
  }
  const target = event.target
  if (!(target instanceof Node)) {
    return
  }
  if (loadChoice.contains(target) || menuLoadButton.contains(target)) {
    return
  }
  loadChoice.classList.add('is-hidden')
})

markerListItems?.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }
  const button = target.closest('.marker-list-link')
  if (!(button instanceof HTMLElement)) {
    return
  }
  const markerId = button.dataset.markerId
  if (!markerId) {
    return
  }
  const markerData = markerListRegistry.get(markerId)
  if (!markerData) {
    return
  }
  showMarkerPreview(markerData, { pinned: true })
})

markerListItems?.addEventListener('dblclick', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }
  const button = target.closest('.marker-list-link')
  if (!(button instanceof HTMLElement)) {
    return
  }
  const markerId = button.dataset.markerId
  if (!markerId) {
    return
  }
  const markerData = markerListRegistry.get(markerId)
  if (!markerData) {
    return
  }
  warpToMarker(markerData)
})

markerListItems?.addEventListener('mousemove', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }
  const button = target.closest('.marker-list-link')
  if (!(button instanceof HTMLElement)) {
    if (!markerPreviewPinned) {
      hideMarkerPreview()
    }
    return
  }
  const markerId = button.dataset.markerId
  if (!markerId) {
    if (!markerPreviewPinned) {
      hideMarkerPreview()
    }
    return
  }
  const markerData = markerListRegistry.get(markerId)
  showMarkerPreview(markerData, { pinned: false })
})

markerListItems?.addEventListener('mouseleave', () => {
  if (!markerPreviewPinned) {
    hideMarkerPreview()
  }
})

const markerListTapState = {
  lastTapAt: 0,
  lastTapMarkerId: '',
}

markerListItems?.addEventListener(
  'touchend',
  (event) => {
    if (event.changedTouches.length !== 1) {
      return
    }
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    const button = target.closest('.marker-list-link')
    if (!(button instanceof HTMLElement)) {
      return
    }
    const markerId = button.dataset.markerId
    if (!markerId) {
      return
    }

    const now = Date.now()
    const isDoubleTap =
      markerId === markerListTapState.lastTapMarkerId &&
      now - markerListTapState.lastTapAt < 320

    markerListTapState.lastTapAt = now
    markerListTapState.lastTapMarkerId = markerId

    if (!isDoubleTap) {
      return
    }

    const markerData = markerListRegistry.get(markerId)
    if (!markerData) {
      return
    }
    event.preventDefault()
    warpToMarker(markerData)
  },
  { passive: false }
)

document.addEventListener('pointerdown', (event) => {
  if (!markerPreviewPinned) {
    return
  }
  const target = event.target
  if (!(target instanceof Node)) {
    hideMarkerPreview()
    return
  }
  if (markerListItems?.contains(target) || markerPreview.contains(target)) {
    return
  }
  hideMarkerPreview()
})

fileInput.addEventListener('change', async () => {
  await loadSelection(fileInput.files)
})

directoryInput.addEventListener('change', async () => {
  await loadSelection(directoryInput.files)
})

function hasGeneratedLod(mesh) {
  return Boolean(mesh.packedSplats?.lodSplats || mesh.extSplats?.lodSplats)
}

function initializeLodRamp() {
  lodRampState.active = true
  lodRampState.settleTime = 0
  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
  lodPerfState.frameMs = LOD_TARGET_FRAME_MS
  lodPerfState.quality = 1
  spark.lodSplatScale = LOD_SCALE_COARSE
}

function updateLodPerfBudget(deltaTime) {
  const currentFrameMs = deltaTime * 1000
  lodPerfState.frameMs = THREE.MathUtils.lerp(
    lodPerfState.frameMs,
    currentFrameMs,
    LOD_FRAME_EMA_ALPHA
  )

  const slowThresholdMs = LOD_TARGET_FRAME_MS * LOD_SLOW_FRAME_MULTIPLIER
  const fastThresholdMs = LOD_TARGET_FRAME_MS * LOD_FAST_FRAME_MULTIPLIER

  if (lodPerfState.frameMs > slowThresholdMs) {
    const overshoot = lodPerfState.frameMs / slowThresholdMs
    lodPerfState.quality = clampLodQuality(
      lodPerfState.quality -
        LOD_QUALITY_DROP_PER_SEC *
          deltaTime *
          Math.min(LOD_QUALITY_DROP_OVERSHOOT_CAP, overshoot)
    )
  } else if (lodPerfState.frameMs < fastThresholdMs) {
    const headroom = fastThresholdMs / Math.max(1e-6, lodPerfState.frameMs)
    lodPerfState.quality = clampLodQuality(
      lodPerfState.quality +
        LOD_QUALITY_RISE_PER_SEC *
          deltaTime *
          Math.min(LOD_QUALITY_RISE_HEADROOM_CAP, headroom)
    )
  }
}

async function initializeLod(targetSplat = activeSplat) {
  if (!targetSplat) {
    lodRampState.active = false
    lodStatus.textContent = 'No splat loaded'
    return
  }
  lodRampState.active = false

  try {
    lodStatus.textContent = 'Loading splats...'
    await targetSplat.initialized

    const canCreateLod = typeof targetSplat.createLodSplats === 'function'
    if (!hasGeneratedLod(targetSplat) && canCreateLod) {
      lodStatus.textContent = 'Generating LoD tree in Spark...'
      await targetSplat.createLodSplats({ quality: true })
    }

    if (hasGeneratedLod(targetSplat)) {
      targetSplat.enableLod = true
      initializeLodRamp()
      lodStatus.textContent = 'LoD enabled (coarse -> fine)'
    } else if (!canCreateLod) {
      lodStatus.textContent = 'LoD API unavailable in current Spark build'
    } else {
      lodStatus.textContent = 'LoD not available for this file/runtime'
    }

    window.setTimeout(() => {
      lodStatus.classList.add('is-hidden')
    }, 2200)
  } catch (error) {
    console.error('Failed to initialize LoD tree', error)
    const reason = error instanceof Error ? error.message : String(error)
    lodStatus.textContent = `LoD disabled: ${reason.slice(0, 64)}`
    lodRampState.active = false
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  updateRendererViewport()
})

function updateLook(deltaTime) {
  if (imageViewState.open) {
    return
  }
  if (isCoarsePointer) {
    if (touchInput.lookX === 0 && touchInput.lookY === 0) {
      return
    }
    requestCoarseLod()

    lookState.yaw -=
      touchInput.lookX * LOOK_SPEED * MOBILE_LOOK_SPEED_MULTIPLIER * deltaTime
    lookState.pitch -=
      touchInput.lookY * LOOK_SPEED * MOBILE_LOOK_SPEED_MULTIPLIER * deltaTime
    lookState.pitch = THREE.MathUtils.clamp(lookState.pitch, -1.45, 1.45)
    applyLookDirection()
    return
  }

  if (inertiaState.lookVelocity.lengthSq() < 1e-6) {
    inertiaState.lookVelocity.set(0, 0)
    return
  }

  lookState.yaw += inertiaState.lookVelocity.x * deltaTime
  lookState.pitch += inertiaState.lookVelocity.y * deltaTime
  if (lookState.pitch > 1.45 || lookState.pitch < -1.45) {
    lookState.pitch = THREE.MathUtils.clamp(lookState.pitch, -1.45, 1.45)
    inertiaState.lookVelocity.y = 0
  }
  applyLookDirection()
  inertiaState.lookVelocity.x = expDamp(
    inertiaState.lookVelocity.x,
    LOOK_INERTIA_DAMPING,
    deltaTime
  )
  inertiaState.lookVelocity.y = expDamp(
    inertiaState.lookVelocity.y,
    LOOK_INERTIA_DAMPING,
    deltaTime
  )
  requestCoarseLod()
}

function updateMovement(deltaTime) {
  if (imageViewState.open) {
    return
  }
  let forwardInput = -touchInput.moveY
  let rightInput = touchInput.moveX
  let verticalInput = 0

  if (keyState.KeyW) forwardInput += 1
  if (keyState.KeyS) forwardInput -= 1
  if (keyState.KeyD) rightInput += 1
  if (keyState.KeyA) rightInput -= 1
  if (keyState.KeyE) verticalInput += 1
  if (keyState.KeyQ) verticalInput -= 1

  const hasDirectInput = forwardInput !== 0 || rightInput !== 0 || verticalInput !== 0

  movement.forward.subVectors(controls.target, camera.position)
  if (movement.forward.lengthSq() < 1e-8) {
    movement.forward.set(0, 0, -1)
  } else {
    movement.forward.normalize()
  }

  movement.right.crossVectors(movement.forward, camera.up)
  if (movement.right.lengthSq() < 1e-8) {
    movement.right.set(1, 0, 0)
  } else {
    movement.right.normalize()
  }
  movement.up.copy(camera.up).normalize()

  const inputLength = Math.hypot(forwardInput, rightInput, verticalInput)
  if (inputLength > 1) {
    forwardInput /= inputLength
    rightInput /= inputLength
    verticalInput /= inputLength
  }

  const blend = 1 - Math.exp(-(hasDirectInput ? MOVE_ACCEL : MOVE_DECEL) * deltaTime)
  inertiaState.moveInput.x = THREE.MathUtils.lerp(
    inertiaState.moveInput.x,
    rightInput,
    blend
  )
  inertiaState.moveInput.y = THREE.MathUtils.lerp(
    inertiaState.moveInput.y,
    verticalInput,
    blend
  )
  inertiaState.moveInput.z = THREE.MathUtils.lerp(
    inertiaState.moveInput.z,
    forwardInput,
    blend
  )

  movement.delta.set(0, 0, 0)
  movement.delta.addScaledVector(
    movement.forward,
    inertiaState.moveInput.z *
      MOVE_SPEED *
      (isCoarsePointer ? MOBILE_MOVE_SPEED_MULTIPLIER : 1) *
      deltaTime
  )
  movement.delta.addScaledVector(
    movement.right,
    inertiaState.moveInput.x *
      MOVE_SPEED *
      (isCoarsePointer ? MOBILE_MOVE_SPEED_MULTIPLIER : 1) *
      deltaTime
  )
  movement.delta.addScaledVector(
    movement.up,
    inertiaState.moveInput.y *
      MOVE_SPEED *
      (isCoarsePointer ? MOBILE_MOVE_SPEED_MULTIPLIER : 1) *
      deltaTime
  )
  movement.delta.addScaledVector(inertiaState.externalVelocity, deltaTime)

  if (movement.delta.lengthSq() > 1e-10) {
    translateCameraAndTarget(movement.delta)
    requestCoarseLod()
  }

  inertiaState.externalVelocity.multiplyScalar(
    Math.exp(-EXTERNAL_MOVE_DAMPING * deltaTime)
  )
  if (inertiaState.externalVelocity.lengthSq() < 1e-6) {
    inertiaState.externalVelocity.set(0, 0, 0)
  }
}

function updateAdaptiveLod(deltaTime) {
  if (!lodRampState.active || !activeSplat) {
    return
  }
  updateLodPerfBudget(deltaTime)

  const positionDelta = camera.position.distanceTo(lodRampState.lastPos)
  const angleDelta = camera.quaternion.angleTo(lodRampState.lastQuat)
  const motion = positionDelta + angleDelta * 2.0
  const coarseRequested =
    lodRampState.controlsInteracting || nowSeconds() < lodRampState.forceCoarseUntil

  if (coarseRequested || motion > LOD_MOTION_THRESHOLD) {
    lodRampState.settleTime = 0
    const budgetedMotionScale = getBudgetedLodScale(LOD_SCALE_MOTION)
    spark.lodSplatScale = THREE.MathUtils.lerp(
      spark.lodSplatScale,
      budgetedMotionScale,
      LOD_MOTION_LERP_ALPHA
    )
  } else {
    lodRampState.settleTime = Math.min(
      LOD_RAMP_SECONDS,
      lodRampState.settleTime + deltaTime
    )
    const rampTargetScale = getLodRampTargetScale(lodRampState.settleTime)
    const budgetedTargetScale = getBudgetedLodScale(rampTargetScale)
    spark.lodSplatScale = THREE.MathUtils.lerp(
      spark.lodSplatScale,
      budgetedTargetScale,
      LOD_SETTLED_LERP_ALPHA
    )
  }

  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
}

function animate(timestampMs = 0) {
  requestAnimationFrame(animate)
  const deltaTime = Math.min(clock.getDelta(), 0.05)
  skyDome.position.copy(camera.position)
  updateLook(deltaTime)
  updateMovement(deltaTime)
  if (isCoarsePointer) {
    camera.lookAt(controls.target)
  } else {
    controls.update()
    if (!desktopLookState.dragging) {
      syncLookStateFromCamera()
    }
  }
  updateAdaptiveLod(deltaTime)
  renderer.render(scene, camera)
}

animate()
