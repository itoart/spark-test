import './style.css'
import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MOVE_SPEED = 10
const LOOK_SPEED = 2.2
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches
const LOD_SCALE_COARSE = isCoarsePointer ? 0.85 : 1.0
const LOD_SCALE_FINE = isCoarsePointer ? 2.0 : 2.6
const LOD_RAMP_SECONDS = 1.8
const LOD_MOTION_THRESHOLD = 0.22
const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 0, 20)
const INITIAL_TARGET = new THREE.Vector3(0, 0, 0)

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
)
camera.position.copy(INITIAL_CAMERA_POSITION)

const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

document.body.innerHTML = ''
document.body.appendChild(renderer.domElement)

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
lodStatus.textContent = 'Loading splats...'
document.body.appendChild(lodStatus)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
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

syncLookStateFromCamera()

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
  event.preventDefault()
})

window.addEventListener('keyup', (event) => {
  if (!(event.code in keyState)) {
    return
  }

  keyState[event.code] = false
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
  enableLod: true,
  lodSplatScale: LOD_SCALE_COARSE,
  behindFoveate: 1.0,
  numLodFetchers: isCoarsePointer ? 2 : 4,
})
scene.add(spark)

const splat = new SplatMesh({
  url: `${import.meta.env.BASE_URL}splat_100000.splat`,
  lod: true,
  nonLod: true,
  enableLod: false,
  behindFoveate: 1.0,
})
splat.rotation.x = Math.PI
scene.add(splat)

function hasGeneratedLod(mesh) {
  return Boolean(mesh.packedSplats?.lodSplats || mesh.extSplats?.lodSplats)
}

function initializeLodRamp() {
  lodRampState.active = true
  lodRampState.settleTime = 0
  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
  spark.lodSplatScale = LOD_SCALE_COARSE
}

async function initializeLod() {
  try {
    lodStatus.textContent = 'Loading splats...'
    await splat.initialized

    const canCreateLod = typeof splat.createLodSplats === 'function'
    if (!hasGeneratedLod(splat) && canCreateLod) {
      lodStatus.textContent = 'Generating LoD tree in Spark...'
      await splat.createLodSplats({ quality: true })
    }

    if (hasGeneratedLod(splat)) {
      splat.enableLod = true
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
    splat.enableLod = false
  }
}

initializeLod()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function updateLook(deltaTime) {
  if (!isCoarsePointer) {
    return
  }

  if (touchInput.lookX === 0 && touchInput.lookY === 0) {
    return
  }

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
  if (!lodRampState.active || !splat.enableLod) {
    return
  }

  const positionDelta = camera.position.distanceTo(lodRampState.lastPos)
  const angleDelta = camera.quaternion.angleTo(lodRampState.lastQuat)
  const motion = positionDelta + angleDelta * 3.0

  if (motion > LOD_MOTION_THRESHOLD) {
    lodRampState.settleTime = 0
  } else {
    lodRampState.settleTime = Math.min(
      LOD_RAMP_SECONDS,
      lodRampState.settleTime + deltaTime
    )
  }

  const t = lodRampState.settleTime / LOD_RAMP_SECONDS
  const targetScale = THREE.MathUtils.lerp(LOD_SCALE_COARSE, LOD_SCALE_FINE, t)
  spark.lodSplatScale = THREE.MathUtils.lerp(
    spark.lodSplatScale,
    targetScale,
    0.12
  )

  lodRampState.lastPos.copy(camera.position)
  lodRampState.lastQuat.copy(camera.quaternion)
}

function animate() {
  requestAnimationFrame(animate)
  const deltaTime = clock.getDelta()
  updateLook(deltaTime)
  updateMovement(deltaTime)
  updateAdaptiveLod(deltaTime)
  if (isCoarsePointer) {
    camera.lookAt(controls.target)
  } else {
    controls.update()
  }
  renderer.render(scene, camera)
}

animate()
