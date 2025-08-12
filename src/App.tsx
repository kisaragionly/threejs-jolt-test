import { useState, useRef, useEffect } from 'react';
import * as THREE from "three";
// import initJolt from "jolt-physics";
import initJolt from "jolt-physics/wasm-compat-multithread";
// import initJolt from "jolt-physics/wasm-multithread";
import './App.css';

class Camera {
  public field_of_view = 75;
  public near_clip = 0.1;
  public far_clip = 1000;

  public camera = new THREE.PerspectiveCamera(
    this.field_of_view,
    window.innerWidth / window.innerHeight,
    this.near_clip,
    this.far_clip
  );

  constructor() {
    this.camera.position.set(0, 20, 30)
    this.camera.rotateX(-0.7)
  }
}

class FPSTracker {
  public fps = 0;
  public frameCount = 0;
  public lastTime = performance.now();

  update(): number {
    const currentTime = performance.now();
    this.frameCount += 1;

    if (currentTime >= this.lastTime + 500) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime));
      this.frameCount = 0;
      this.lastTime = currentTime;
    }

    return this.fps
  }
}

async function setupGame(
  canvasMountRef: HTMLDivElement,
  onFpsUpdate?: (fps: number) => void,
  onCubesAmountUpdate?: (cubesAmount: number) => void,
) {
  const clock = new THREE.Clock();
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer();
  const camera = new Camera();
  const fpsTracker = new FPSTracker();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasMountRef.appendChild(renderer.domElement);

  function handleResize() {
    camera.camera.aspect = window.innerWidth / window.innerHeight;
    camera.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(10, 10, 5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -20;
  directionalLight.shadow.camera.right = 20;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  scene.add(directionalLight);

  // Physics World
  const Jolt = await initJolt()
  // Record how much memory we have in the beginning
  // const memoryFreeBefore = Jolt.JoltInterface.prototype.sGetFreeMemory();

  // Create very simple object layer filter with only a single layer
  const MY_LAYER = 0;
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(1);
  objectFilter.EnableCollision(MY_LAYER, MY_LAYER);

  // Create very simple broad phase layer interface with only a single layer
  const BP_LAYER = new Jolt.BroadPhaseLayer(0);
  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(1, 1);
  bpInterface.MapObjectToBroadPhaseLayer(MY_LAYER, BP_LAYER);
  Jolt.destroy(BP_LAYER); // 'BP_LAYER' has been copied into bpInterface

  // Create broad phase filter
  const bpFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 1, objectFilter, 1);

  // Initialize Jolt
  const settings = new Jolt.JoltSettings();
  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = bpFilter;
  const jolt = new Jolt.JoltInterface(settings); // Everything in 'settings' has now been copied into 'jolt', the 3 interfaces above are now owned by 'jolt'
  Jolt.destroy(settings);

  // Typing shortcuts
  const physicsSystem = jolt.GetPhysicsSystem();
  const bodyInterface = physicsSystem.GetBodyInterface();

  function createBoxBody(EMotionType: initJolt.EMotionType, position: [number, number, number], size: [number, number, number], layer = MY_LAYER) {
    const material = new Jolt.PhysicsMaterial();
    const boxSize = new Jolt.Vec3(size[0], size[1], size[2]);
    const boxShape = new Jolt.BoxShapeSettings(boxSize, 0.05, material);
    Jolt.destroy(boxSize);

    const shapeResult = boxShape.Create();
    const shape = shapeResult.Get();
    shapeResult.Clear();
    shape.AddRef();
    Jolt.destroy(boxShape);

    const bodyPosition = new Jolt.RVec3(position[0], position[1], position[2]);
    const bodyRotation = new Jolt.Quat(0, 0, 0, 1);
    const creationSettings = new Jolt.BodyCreationSettings(
      shape,
      bodyPosition,
      bodyRotation,
      EMotionType,
      layer
    );

    Jolt.destroy(bodyPosition);
    Jolt.destroy(bodyRotation);
    shape.Release();

    const body = bodyInterface.CreateBody(creationSettings);
    Jolt.destroy(creationSettings);

    bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
    return body;
  }

  // Ground
  // Ground Graphics
  const groundGeometry = new THREE.BoxGeometry(50, 2, 50);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.2, 1, 0.2) });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
  // Ground Physics
  const groundBody = createBoxBody(Jolt.EMotionType_Static, [0, 0, 0], [25, 1, 25]);

  // Cube Setup
  const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
  const cubeMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.1, 0.1, 1) });
  const cubes: { mesh: THREE.Mesh; body: initJolt.Body }[] = [];

  function spawnCube() {
    if (fpsTracker.fps > 50) {
      // Cube Graphics
      const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
      cube.castShadow = true;
      cube.receiveShadow = true;
      scene.add(cube);
      // Cube Physics
      const cubeBody = createBoxBody(Jolt.EMotionType_Dynamic, [
        Math.random() * 3,
        15,
        Math.random() * 3],
        [1, 1, 1],
      );
      cubes.push({ mesh: cube, body: cubeBody });
      if (onCubesAmountUpdate) {
        onCubesAmountUpdate(cubes.length);
      };
    }
  }
  setInterval(spawnCube, 100);

  const fixedTimestep = 1.0 / 60.0;
  let accumulator = 0;
  function frame() {
    accumulator += clock.getDelta();
    if (onFpsUpdate) {
      onFpsUpdate(fpsTracker.update());
    }

    let steps = 0;
    while (accumulator >= fixedTimestep && steps < 5) {
      jolt.Step(fixedTimestep, 1);
      accumulator -= fixedTimestep;
      steps += 1;
    }

    cubes.forEach(({ mesh, body }) => {
      const position = body.GetPosition();
      const rotation = body.GetRotation();
      mesh.position.set(position.GetX(), position.GetY(), position.GetZ());
      mesh.quaternion.set(rotation.GetX(), rotation.GetY(), rotation.GetZ(), rotation.GetW());
    });

    renderer.render(scene, camera.camera);
  }

  renderer.setAnimationLoop(frame);
}

function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const finishedSetup = useRef(false);
  const [fps, setFps] = useState(0);
  const [cubesAmount, setCubesAmount] = useState(0);

  useEffect(() => {
    if (!canvasMountRef.current) return;
    if (finishedSetup.current) return;
    finishedSetup.current = true;

    setupGame(
      canvasMountRef.current,
      (newFps: number) => setFps(newFps),
      (newCubesAmount: number) => setCubesAmount(newCubesAmount),
    )
  }, []);

  return (
    <div className="app">
      <Stats fps={fps} cubesAmount={cubesAmount} />
      <div ref={canvasMountRef} />
    </div>
  )
}

function Stats({ fps, cubesAmount }: { fps: number, cubesAmount: number }) {
  return (
    <div className="stats">
      <p>FPS: {fps}</p>
      <p>Cubes: {cubesAmount}</p>
    </div>
  );
};

export default App
