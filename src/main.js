import './style.css'
import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const MOVE_SPEED = 10
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

const overlay = document.createElement('div')
overlay.className = 'controls-hint'
overlay.innerHTML = `
  <strong>Controls</strong>
  <span>Left drag: Orbit</span>
  <span>Wheel: Zoom</span>
  <span>Right drag or Shift+Left drag: Pan</span>
  <span>W/A/S/D: Move</span>
  <span>Q/E: Move down/up</span>
  <span>R: Reset</span>
`
document.body.appendChild(overlay)

const lodStatus = document.createElement('div')
lodStatus.className = 'lod-status'
lodStatus.textContent = 'Loading splats...'
document.body.appendChild(lodStatus)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.screenSpacePanning = true
controls.target.copy(INITIAL_TARGET)
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

const clock = new THREE.Clock()

function resetView() {
  camera.position.copy(INITIAL_CAMERA_POSITION)
  controls.target.copy(INITIAL_TARGET)
  controls.update()
}

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

const spark = new SparkRenderer({
  renderer,
  enableLod: true,
  lodSplatScale: 1.5,
  behindFoveate: 0.2,
  numLodFetchers: 4,
})
scene.add(spark)

const splat = new SplatMesh({
  url: `${import.meta.env.BASE_URL}splat_100000.splat`,
  enableLod: false,
  behindFoveate: 0.2,
})
splat.rotation.x = Math.PI
scene.add(splat)

async function initializeLod() {
  try {
    lodStatus.textContent = 'Loading splats...'
    await splat.initialized

    lodStatus.textContent = 'Generating LoD tree in Spark...'
    await splat.createLodSplats({ quality: false })

    splat.enableLod = true
    lodStatus.textContent = 'LoD enabled'

    window.setTimeout(() => {
      lodStatus.classList.add('is-hidden')
    }, 1800)
  } catch (error) {
    console.error('Failed to initialize LoD tree', error)
    lodStatus.textContent = 'LoD generation failed'
  }
}

initializeLod()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function updateMovement(deltaTime) {
  let forwardInput = 0
  let rightInput = 0
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

function animate() {
  requestAnimationFrame(animate)
  updateMovement(clock.getDelta())
  controls.update()
  renderer.render(scene, camera)
}

animate()
