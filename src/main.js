import './style.css'
import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MOVE_SPEED = 10
const LOOK_SPEED = 1.1
const ENABLE_LOD = false
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
const cpuCores = navigator.hardwareConcurrency ?? 4
const deviceMemoryGb = navigator.deviceMemory ?? 4
const isLowEndDevice = isCoarsePointer || cpuCores <= 6 || deviceMemoryGb <= 4
const MAX_PIXEL_RATIO = isCoarsePointer ? 1.0 : isLowEndDevice ? 1.15 : 1.5
const LOD_SCALE_COARSE = isCoarsePointer ? 1.2 : 0.9
const LOD_SCALE_FINE = isCoarsePointer ? 2.0 : 2.6
const LOD_RAMP_SECONDS = 2.2
const LOD_MOTION_THRESHOLD = 0.015
const LOD_SETTLE_DELAY_SECONDS = 0.35
const LOD_ENABLE_DELAY_SECONDS = 0.2
const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 2.2, 20)
const INITIAL_TARGET = new THREE.Vector3(0, 2.2, 0)

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor('#000000', 1)

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(2000, 48, 32)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      topColor: { value: new THREE.Color('#1fa3f7') },
      skyColor: { value: new THREE.Color('#b9dbf7') },
      horizonColor: { value: new THREE.Color('#e3e3e3') },
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
        color = mix(color, horizonColor, smoothstep(0.34, 0.54, t));
        color = mix(color, skyColor, smoothstep(0.54, 0.76, t));
        color = mix(color, topColor, smoothstep(0.76, 1.00, t));
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
fileInput.accept = '.ply,.sog,.sogs,.spz,.splat,.ksplat,.json,.zip'
fileInput.style.display = 'none'
document.body.appendChild(fileInput)

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
  <strong>Controls</strong>
  <button class="menu-load-btn" type="button">Load Splat</button>
  <span>${isCoarsePointer ? 'Left pad: Move' : 'Left drag: Orbit'}</span>
  <span>${isCoarsePointer ? 'Right pad: Look around' : 'Wheel: Zoom'}</span>
  <span>${isCoarsePointer ? 'UP/DOWN: Vertical move' : 'Right drag or Shift+Left drag: Pan'}</span>
  <span>${isCoarsePointer ? 'Double tap: Reset view' : 'W/A/S/D: Move'}</span>
  <span>${isCoarsePointer ? 'Q/E keys also work' : 'Q/E: Move down/up'}</span>
  <span>R: Reset</span>
`
document.body.appendChild(overlay)

controlsToggle.addEventListener('click', () => {
  overlay.classList.toggle('is-collapsed')
  controlsToggle.setAttribute(
    'aria-expanded',
    String(!overlay.classList.contains('is-collapsed'))
  )
})

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

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.rotateSpeed = 0.5
controls.screenSpacePanning = true
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

const lookState = {
  yaw: 0,
  pitch: 0,
}
const lodRampState = {
  active: false,
  settleTime: 0,
  controlsInteracting: false,
  forceCoarseUntil: 0,
  lodEnableCooldown: 0,
  lastPos: new THREE.Vector3(),
  lastQuat: new THREE.Quaternion(),
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

syncLookStateFromCamera()

controls.addEventListener('start', () => {
  lodRampState.controlsInteracting = true
  requestCoarseLod(1.0)
})
controls.addEventListener('end', () => {
  lodRampState.controlsInteracting = false
  requestCoarseLod()
})

window.addEventListener('keydown', (event) => {
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
  if (!(code in keyState)) {
    return
  }
  keyState[code] = pressed
  requestCoarseLod()
}

function bindVirtualStick({ root, base, stick, setX, setY }) {
  const maxRadius = 36

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
    <div class="mobile-look-group">
      <div class="mobile-look">
        <div class="mobile-stick-label">LOOK</div>
        <div class="mobile-stick-base" data-stick="look">
          <div class="mobile-stick"></div>
        </div>
      </div>
      <div class="mobile-vertical">
        <button data-key="KeyE">UP</button>
        <button data-key="KeyQ">DOWN</button>
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
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) {
      return
    }
    const now = Date.now()
    if (now - lastTapAt < 280) {
      resetView()
    }
    lastTapAt = now
  })

  document.body.appendChild(mobileControls)
}

createMobileControls()

const spark = new SparkRenderer({
  renderer,
  enableLod: ENABLE_LOD,
  maxStdDev: Math.sqrt(isCoarsePointer ? 4 : 5),
  maxPixelRadius: isCoarsePointer ? 160 : 256,
  minPixelRadius: isCoarsePointer ? 0.6 : 0.4,
  minAlpha: isCoarsePointer ? 0.01 : 0.006,
  minSortIntervalMs: isLowEndDevice ? 24 : 12,
  lodSplatScale: LOD_SCALE_COARSE,
  behindFoveate: 1.0,
  numLodFetchers: isCoarsePointer ? 2 : 4,
})
scene.add(spark)

let activeSplat = null

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
    const nextSplat = new SplatMesh({
      fileBytes,
      fileName: file.name,
      lod: ENABLE_LOD,
      nonLod: true,
      enableLod: false,
      behindFoveate: 1.0,
    })
    nextSplat.rotation.x = Math.PI
    scene.add(nextSplat)
    await nextSplat.initialized

    const prevSplat = activeSplat
    activeSplat = nextSplat
    if (prevSplat) {
      scene.remove(prevSplat)
      prevSplat.dispose()
    }

    await initializeLod(activeSplat)
    resetView()
    lodStatus.textContent = `Loaded: ${file.name}`
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

const menuLoadButton = overlay.querySelector('.menu-load-btn')
menuLoadButton?.addEventListener('click', () => {
  fileInput.value = ''
  fileInput.click()
})

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) {
    return
  }
  await loadLocalSplat(file)
})

function hasGeneratedLod(mesh) {
  return Boolean(mesh.packedSplats?.lodSplats || mesh.extSplats?.lodSplats)
}

function initializeLodRamp() {
  lodRampState.active = true
  lodRampState.settleTime = 0
  lodRampState.lodEnableCooldown = 0
  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
  spark.lodSplatScale = LOD_SCALE_COARSE
}

async function initializeLod(targetSplat = activeSplat) {
  if (!targetSplat) {
    lodStatus.textContent = 'No splat loaded'
    return
  }

  if (!ENABLE_LOD) {
    targetSplat.enableLod = false
    lodStatus.textContent = 'LoD disabled'
    return
  }

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
    targetSplat.enableLod = false
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function updateLook(deltaTime) {
  if (!isCoarsePointer) {
    return
  }

  if (touchInput.lookX === 0 && touchInput.lookY === 0) {
    return
  }
  requestCoarseLod()

  lookState.yaw -= touchInput.lookX * LOOK_SPEED * deltaTime
  lookState.pitch -= touchInput.lookY * LOOK_SPEED * deltaTime
  lookState.pitch = THREE.MathUtils.clamp(lookState.pitch, -1.45, 1.45)

  const cosPitch = Math.cos(lookState.pitch)
  const direction = new THREE.Vector3(
    Math.sin(lookState.yaw) * cosPitch,
    Math.sin(lookState.pitch),
    Math.cos(lookState.yaw) * cosPitch
  )

  controls.target.copy(camera.position).add(direction)
}

function updateMovement(deltaTime) {
  let forwardInput = -touchInput.moveY
  let rightInput = touchInput.moveX
  let verticalInput = 0

  if (keyState.KeyW) forwardInput += 1
  if (keyState.KeyS) forwardInput -= 1
  if (keyState.KeyD) rightInput += 1
  if (keyState.KeyA) rightInput -= 1
  if (keyState.KeyE) verticalInput += 1
  if (keyState.KeyQ) verticalInput -= 1

  if (forwardInput === 0 && rightInput === 0 && verticalInput === 0) {
    return
  }
  requestCoarseLod()

  movement.forward.subVectors(controls.target, camera.position)
  movement.forward.y = 0
  if (movement.forward.lengthSq() === 0) {
    movement.forward.set(0, 0, -1)
  } else {
    movement.forward.normalize()
  }

  movement.right.crossVectors(movement.forward, camera.up).normalize()
  movement.up.copy(camera.up).normalize()

  movement.delta.set(0, 0, 0)
  movement.delta.addScaledVector(movement.forward, forwardInput)
  movement.delta.addScaledVector(movement.right, rightInput)
  movement.delta.addScaledVector(movement.up, verticalInput)

  if (movement.delta.lengthSq() === 0) {
    return
  }

  movement.delta.normalize().multiplyScalar(MOVE_SPEED * deltaTime)
  camera.position.add(movement.delta)
  controls.target.add(movement.delta)
}

function updateAdaptiveLod(deltaTime) {
  if (!lodRampState.active || !activeSplat) {
    return
  }

  const positionDelta = camera.position.distanceTo(lodRampState.lastPos)
  const angleDelta = camera.quaternion.angleTo(lodRampState.lastQuat)
  const motion = positionDelta + angleDelta * 2.0
  const coarseRequested =
    lodRampState.controlsInteracting || nowSeconds() < lodRampState.forceCoarseUntil

  if (coarseRequested || motion > LOD_MOTION_THRESHOLD) {
    lodRampState.settleTime = 0
    lodRampState.lodEnableCooldown = LOD_ENABLE_DELAY_SECONDS
    if (activeSplat.enableLod) {
      activeSplat.enableLod = false
    }
    spark.lodSplatScale = THREE.MathUtils.lerp(
      spark.lodSplatScale,
      LOD_SCALE_COARSE,
      0.35
    )
  } else {
    lodRampState.lodEnableCooldown = Math.max(
      0,
      lodRampState.lodEnableCooldown - deltaTime
    )
    if (!activeSplat.enableLod && lodRampState.lodEnableCooldown === 0) {
      activeSplat.enableLod = true
    }

    lodRampState.settleTime = Math.min(
      LOD_RAMP_SECONDS,
      lodRampState.settleTime + deltaTime
    )
    const t = lodRampState.settleTime / LOD_RAMP_SECONDS
    const targetScale = THREE.MathUtils.lerp(LOD_SCALE_COARSE, LOD_SCALE_FINE, t)
    spark.lodSplatScale = THREE.MathUtils.lerp(
      spark.lodSplatScale,
      targetScale,
      0.12
    )
  }

  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
}

function animate() {
  requestAnimationFrame(animate)
  const deltaTime = clock.getDelta()
  skyDome.position.copy(camera.position)
  updateLook(deltaTime)
  updateMovement(deltaTime)
  if (isCoarsePointer) {
    camera.lookAt(controls.target)
  } else {
    controls.update()
  }
  updateAdaptiveLod(deltaTime)
  renderer.render(scene, camera)
}

animate()
