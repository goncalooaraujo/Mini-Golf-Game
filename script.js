// ------------------------------
// Imports and Globals
// ------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// THREE.js scene and renderer setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

const topCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
topCamera.position.set(0, 30, 430);
topCamera.lookAt(0, 30, 480);

// Mini map Camera 
const miniMapCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 5000); // Aspect ratio de 1 para o mini mapa quadrado
miniMapCamera.position.set(0, 50, 0);
miniMapCamera.lookAt(0, 0, 0);

// Configuração do mini mapa
const MINIMAP_SIZE = 200; // Tamanho do mini mapa em pixels
const MINIMAP_PADDING = 10; // Espaçamento do canto

let showMiniMap = true;
let minimapBorder = null;
let activeCamera = camera;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Cannon.js physics world
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.81 * 12, 0),
});

// Materials
const mapMaterial = new CANNON.Material('mapMaterial');
mapMaterial.restitution = 0.15;  // small bounce
mapMaterial.friction = 0.02;     // low friction for smooth rolling

const ballMaterial = new CANNON.Material('ballMaterial');
ballMaterial.restitution = 0.15;

const contactMaterial = new CANNON.ContactMaterial(mapMaterial, ballMaterial, {
  friction: 0.02,
  restitution: 0.15,
});
world.addContactMaterial(contactMaterial);

// Ground physics
const groundBody = new CANNON.Body({
  type: CANNON.Body.STATIC,
  shape: new CANNON.Plane(),
  material: mapMaterial,
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// Visual ground
const groundGeo = new THREE.PlaneGeometry(10000, 10000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Lighting
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.castShadow = true;
directionalLight.shadow.bias = -0.0001;
directionalLight.shadow.mapSize.set(1024, 1024);
directionalLight.shadow.camera.left = -50;
directionalLight.shadow.camera.right = 50;
directionalLight.shadow.camera.top = 50;
directionalLight.shadow.camera.bottom = -50;
directionalLight.shadow.camera.near = 1;
directionalLight.shadow.camera.far = 10000;
scene.add(directionalLight);
scene.add(directionalLight.target);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// ------------------------------
// Variables and State
// ------------------------------
let ballMesh, ballBody;
let mapMeshes = [];

let cameraAngle = 91;
let zoomOutCamera = false;
let canShoot = true;
let lastBallPos;
let zoomHeight = 5;

let forcePower = 0;
let forceInterval;
let isCharging = false;

let score = 0;
let strokes = 0;
let pontosTotais = 0;

// Bounding spheres for goal detection
const sphere = new THREE.Sphere(new THREE.Vector3(.8, -1.9, 510), 6);
const sphere2 = new THREE.Sphere(new THREE.Vector3(.8, -3, 510), 20);

/* debug da esfera 
const debugGeo = new THREE.SphereGeometry(sphere.radius, 16, 16);
const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
const debugMesh = new THREE.Mesh(debugGeo, debugMat);
debugMesh.position.copy(sphere.center);
scene.add(debugMesh);
*/

// For deferred reset to avoid physics glitches
let resetBallNextFrame = false;

// ------------------------------
// Load Models and Setup Physics
// ------------------------------
function initBallPhysics() {
  const loader = new GLTFLoader();

  loader.load(
    'assets/models/golf_ball.glb',
    (gltf) => {
      ballMesh = gltf.scene;
      ballMesh.scale.set(1.15, 1.15, 1.15);
      ballMesh.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      scene.add(ballMesh);

      const radius = 1.15;
      const shape = new CANNON.Sphere(radius);
      ballBody = new CANNON.Body({
        mass: 1.2,
        shape,
        position: new CANNON.Vec3(0, 10 + radius, 450),
        material: ballMaterial,
        angularDamping: 0.99,  // natural rolling spin
        linearDamping: 0.02,   // slight slow down
      });
      world.addBody(ballBody);

      ballBody.In = false;

      // Collision event to trigger deferred reset
      ballBody.addEventListener('collide', (event) => {
        if (event.body === groundBody) {
          if (ballBody.velocity.length() < 0.3) {
            resetBallNextFrame = true;
          }
        }
      });
    },
    undefined,
    (err) => console.error('Failed to load ball model:', err)
  );
}

function resetBall() {
  if (!ballBody || !ballMesh) return;

  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.position.set(0, 10 + 1.15, 450);
  ballBody.In = false;
  strokes = 0;
  document.getElementById('strokes').textContent = `Tacadas: 0`;
}


function loadMap() {
  const loader = new GLTFLoader();

  loader.load(
    'assets/models/mapa1.glb',
    (gltf) => {
      const mapMesh = gltf.scene;
      mapMesh.scale.set(1, 1.3, 1);
      mapMesh.position.set(45, 0, 0);
      scene.add(mapMesh);

      mapMeshes = [];
      mapMesh.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          mapMeshes.push(node);

          node.updateWorldMatrix(true, true);

          const geometry = node.geometry.clone();
          geometry.applyMatrix4(node.matrixWorld);
          geometry.computeVertexNormals();

          if (!geometry.attributes.position || !geometry.index) return;

          const vertices = Array.from(geometry.attributes.position.array);
          const indices = Array.from(geometry.index.array);
          const shape = new CANNON.Trimesh(vertices, indices);

          const body = new CANNON.Body({ mass: 0, material: mapMaterial });
          body.addShape(shape);
          body.restitution = 0.15;
          world.addBody(body);
        }
      });
    },
    undefined,
    (err) => console.error('Failed to load map:', err)
  );
}

// ------------------------------
// Utility: Create Street Lights
// ------------------------------
function createStreetLights() {
  function createLight(x = 10, z = 450, rotY = 0) {
    const poste = new THREE.Group();

    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 16);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.7,
      roughness: 0.3,
    });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 2.5;
    pole.castShadow = true;
    pole.receiveShadow = true;
    poste.add(pole);

    const path = new THREE.CurvePath();
    path.add(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 5, 0),
        new THREE.Vector3(0.5, 5.5, 0),
        new THREE.Vector3(1, 5, 0)
      )
    );

    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.05, 8, false);
    const tube = new THREE.Mesh(tubeGeo, poleMat);
    tube.castShadow = true;
    tube.receiveShadow = true;
    poste.add(tube);

    const lampGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xffffaa,
      emissiveIntensity: 1,
    });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(1, 4.9, 0);
    lamp.castShadow = true;
    poste.add(lamp);

    const light = new THREE.PointLight(0xffffaa, 1.5, 20, 2);
    light.position.set(1, 4.9, 0);
    light.castShadow = true;
    poste.add(light);

    poste.position.set(x, 0, z);
    poste.scale.set(6, 6, 6);
    poste.rotation.y = rotY;

    scene.add(poste);
  }

  createLight(22, 480, Math.PI / 1);
  createLight(-22, 480);
}

// ------------------------------
// Camera Controls & Input Handling
// ------------------------------
function updateCameraPosition() {
  if (!ballBody) return;

  const distance = 15;

  if (zoomOutCamera && zoomHeight < 30) {
    zoomHeight += 0.6;
  } else if (!zoomOutCamera && zoomHeight > 5) {
    zoomHeight -= 0.6;
  }

  camera.position.x = ballMesh.position.x + distance * Math.sin(cameraAngle);
  camera.position.z = ballMesh.position.z + distance * Math.cos(cameraAngle);
  camera.position.y = ballMesh.position.y + zoomHeight;
  camera.lookAt(ballMesh.position);
}

function ballMoving() {
  if (ballBody && ballBody.velocity.length() > 0.3) {
    return true;
  }
  lastBallPos = new CANNON.Vec3().copy(ballBody.position);
  return false;
}

const rotatingKeys = {
  left: false,
  right: false,
};

function setupInputControls() {
  const raycaster = new THREE.Raycaster();

  window.addEventListener('keydown', (event) => {
    if (event.key === 'a' || event.key === 'A') rotatingKeys.left = true;
    if (event.key === 'd' || event.key === 'D') rotatingKeys.right = true;

    if (event.code === 'Space' && canShoot && !isCharging && !ballMoving()) {
      forcePower = 0;
      isCharging = true;
      startClock();
      strokes += 1;
      document.getElementById('strokes').textContent = `Tacadas: ${strokes}`;

      forceInterval = setInterval(() => {
        if (forcePower < 100) {
          forcePower += 2.5;
          updateForceBar(forcePower);
        } else {
          clearInterval(forceInterval);
        }
      }, 25);
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'a' || event.key === 'A') rotatingKeys.left = false;
    if (event.key === 'd' || event.key === 'D') rotatingKeys.right = false;

    if (event.code === 'Space' && isCharging && !ballMoving()) {
      const impulseStrength = forcePower * 5;

      const direction = new THREE.Vector3(
        -Math.sin(cameraAngle),
        0,
        -Math.cos(cameraAngle)
      ).normalize();

      const impulse = new CANNON.Vec3(
        direction.x * impulseStrength,
        0.1,
        direction.z * impulseStrength
      );

      const origin = new THREE.Vector3().copy(ballBody.position);
      const rayOrigin = origin.clone().add(direction.clone().multiplyScalar(-0.5));
      raycaster.set(rayOrigin, direction);
      const intersects = raycaster.intersectObjects(mapMeshes, true);

      const wallHit = intersects.length > 0 && intersects[0].distance < 35;

      if (wallHit) {
        const hit = intersects[0];
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const distanceToWall = hit.point.distanceTo(ballBody.position);
        const offset = 0.5;
        const targetPos = hit.point.clone().add(normal.multiplyScalar(offset));

        const slideSpeed = 25;
        const currentPos = new CANNON.Vec3().copy(ballBody.position);
        const targetCannon = new CANNON.Vec3(targetPos.x, targetPos.y, targetPos.z);
        const slideDir = targetCannon.vsub(currentPos).unit();

        if (distanceToWall >= 2.2) {
          ballBody.velocity.set(
            slideDir.x * slideSpeed,
            slideDir.y * slideSpeed,
            slideDir.z * slideSpeed
          );
          ballBody.applyImpulse(impulse.scale(0.8), ballBody.position);
        } else {
          ballBody.applyImpulse(impulse.scale(0.2), ballBody.position);
          const backOffset = normal.multiplyScalar(0.2);
          const adjustedPos = hit.point.clone().add(backOffset);
          ballBody.position.set(adjustedPos.x, adjustedPos.y, adjustedPos.z);
        }
      } else {
        ballBody.applyImpulse(impulse, ballBody.position);
      }

      clearInterval(forceInterval);
      isCharging = false;
      forcePower = 0;
      updateForceBar(forcePower);
    }
  });
}

function updateForceBar(forcePower) {
  const forceFill = document.getElementById('force-fill');
  if (forceFill) {
    forceFill.style.width = forcePower + '%';
  }
}

// ------------------------------
// Points and Time 
// ------------------------------
let clockIntervalId = null;
let startTime = null;
let elapsedTime = 0;
let savedTimes = [];

function formatTime(ms) {
  const milliseconds = ms % 1000;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;

  const format = (val, len = 2) => String(val).padStart(len, '0');
  return `${format(minutes)}:${format(seconds)}:${format(milliseconds, 3)}`;
}

function updateClock() {
  if (startTime === null) {
    document.querySelector('#clock p').textContent = formatTime(0);
    return;
  }

  const now = Date.now();
  const totalElapsed = now - startTime + elapsedTime;
  document.querySelector('#clock p').textContent = formatTime(totalElapsed);
}

function startClock() {
  if (clockIntervalId === null) {
    elapsedTime = 0;
    startTime = Date.now();
    clockIntervalId = setInterval(updateClock, 100);
    console.log('clock started');
  }
}

function stopClock() {
  if (clockIntervalId !== null) {
    clearInterval(clockIntervalId);
    const now = Date.now();
    elapsedTime += now - startTime;
    savedTimes.push(elapsedTime);

    clockIntervalId = null;
    startTime = null;
    elapsedTime = 0;
  }
}

function calcularPontos(tacadas, par, tempoMs) { // no futuro adicionar mais variaveis para ser mais facil para cada mapa depois
  //console.log(tacadas, par, tempoMs);
  let pontos = 0;
  if (tacadas === par) {
    pontos += 100;// par = tacadas aconselhadas
  } else if (tacadas < par) {
    pontos += 150; // Birdie = menor que par
  } else if (tacadas === par + 1) {
    pontos += 70; // 1 a mais que par
  } else {
    pontos += 30; // maior que par 
  }
  // Bónus por tempo rápido
  if (tempoMs < 15000) {
    pontos += 50;
  } else if (tempoMs < 30000) {
    pontos += 25;
  }
  pontosTotais += pontos;
  document.getElementById('score').textContent = `Pontos: ${pontosTotais}`;

  return pontos;
}

// ------------------------------
// Visual Effects: Arrows and Fireworks
// ------------------------------
let arrowGroup = null;
function updateArrows() {
  // Remove setas antigas
  if (arrowGroup) {
    scene.remove(arrowGroup);
    arrowGroup = null;
  }

  if (!ballBody || ballMoving() || !isCharging) return;

  arrowGroup = new THREE.Group();

  // Direção da bola
  const direction = new THREE.Vector3(
    -Math.sin(cameraAngle),
    0,
    -Math.cos(cameraAngle)
  ).normalize();

  // Posição inicial da bola
  const startPos = new THREE.Vector3(
    ballBody.position.x,
    ballBody.position.y,
    ballBody.position.z
  );

  const arrowCount = 8;
  const gravity = -9.8; // gravidade simulada
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });


  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0);
  arrowShape.lineTo(-0.6, -1.2);
  arrowShape.lineTo(0.6, -1.2);
  arrowShape.lineTo(0, 0);

  const extrudeSettings = { depth: 0.2, bevelEnabled: false };
  const arrowGeometry = new THREE.ExtrudeGeometry(arrowShape, extrudeSettings);

  const power = forcePower;

  for (let i = 1; i <= arrowCount; i++) {
    const t = i * 0.025;

    const pos = new THREE.Vector3(
      startPos.x + direction.x * power * t,
      startPos.y + direction.y * power * t + 0.5 * gravity * t * t,
      startPos.z + direction.z * power * t
    );

    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    arrow.position.copy(pos);
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = Math.atan2(direction.x, direction.z) + Math.PI;


    arrowGroup.add(arrow);
  }

  scene.add(arrowGroup);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchManyRockets() {
  const basePos = ballBody.position.clone();

  for (let i = 0; i < 56; i++) {
    const pos = basePos.clone();
    pos.x += (Math.random() - 0.5) * 20;
    pos.z += (Math.random() - 0.5) * 20;

    launchRocket(pos);
    await sleep(50);
  }
}

function launchRocket(position) {
  const rocketGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const rocketMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 1,
  });

  const rocket = new THREE.Mesh(rocketGeo, rocketMat);
  rocket.scale.set(4, 4, 4);
  rocket.position.copy(position);
  scene.add(rocket);

  let velocity = 0.9;
  let maxHeight = position.y + 30 + Math.random() * 10;

  function animateRocket() {
    rocket.position.y += velocity;

    if (rocket.position.y >= maxHeight) {
      launchFireworks(rocket.position.clone());
      scene.remove(rocket);
      return;
    }

    requestAnimationFrame(animateRocket);
  }

  animateRocket();
}

function launchFireworks(position) {
  const particleCount = 100;
  const positions = new Float32Array(particleCount * 3);

  const color = {
    verde: 0x00ff00,
    vermelho: 0xff0000,
    azul: 0x0000ff,
    amarelo: 0xffff00,
    laranja: 0xffa500,
    roxo: 0x800080,
    rosa: 0xffc0cb,
    ciano: 0x00ffff,
  };

  function getRandomColor() {
    const keys = Object.keys(color);
    return color[keys[Math.floor(Math.random() * keys.length)]];
  }

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = position.x + (Math.random() - 0.5);
    positions[i * 3 + 1] = position.y + (Math.random() - 0.5);
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5);
  }

  const particles = new THREE.BufferGeometry();
  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: getRandomColor(),
    size: 1,
    transparent: true,
    opacity: 1,
  });

  const particleSystem = new THREE.Points(particles, material);
  scene.add(particleSystem);

  const velocities = [];
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 1;
    const verticalSpeed = Math.random() * 5 + 2;
    velocities.push(new THREE.Vector3(
      Math.cos(angle) * speed,
      verticalSpeed,
      Math.sin(angle) * speed
    ));
  }

  function animateFireworks() {
    const posArray = particles.attributes.position.array;

    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3] += velocities[i].x * 0.1;
      posArray[i * 3 + 1] += velocities[i].y * 0.1;
      posArray[i * 3 + 2] += velocities[i].z * 0.1;
      velocities[i].y -= 0.05;
    }

    particles.attributes.position.needsUpdate = true;
    material.opacity -= 0.01;

    if (material.opacity > 0) {
      requestAnimationFrame(animateFireworks);
    } else {
      scene.remove(particleSystem);
    }
  }

  animateFireworks();
}

// Minimap Border
function createMinimapBorder() {
  if (minimapBorder) return;

  console.log("E")
  minimapBorder = document.createElement('div');
  minimapBorder.style.position = 'absolute';
  minimapBorder.style.top = MINIMAP_PADDING + 'px';
  minimapBorder.style.right = MINIMAP_PADDING + 'px';
  minimapBorder.style.width = MINIMAP_SIZE + 'px';
  minimapBorder.style.height = MINIMAP_SIZE + 'px';
  minimapBorder.style.border = '2px solid white';
  minimapBorder.style.borderRadius = '5px';
  minimapBorder.style.pointerEvents = 'none';
  document.body.appendChild(minimapBorder);
}

// ------------------------------
// Animation Loop
// ------------------------------
let lastTime;

function animate(time) {
  requestAnimationFrame(animate);



  if (!lastTime) {
    lastTime = time;
    return;
  }

  const delta = (time - lastTime) / 1000;
  lastTime = time;

  // Reset ball position and velocity safely if flagged
  if (resetBallNextFrame) {
    ballBody.velocity.set(0, 0, 0);
    ballBody.angularVelocity.set(0, 0, 0);
    ballBody.position.set(lastBallPos.x, lastBallPos.y, lastBallPos.z);
    resetBallNextFrame = false;
  }

  world.step(1 / 480, delta, 60);

  updateClock();

  if (ballMesh && ballBody) {
    ballMesh.position.copy(ballBody.position);
    ballMesh.quaternion.copy(ballBody.quaternion);
  }

  if (rotatingKeys.left) cameraAngle += 0.015;
  if (rotatingKeys.right) cameraAngle -= 0.015;

  updateArrows();
  updateCameraPosition();
  renderer.render(scene, activeCamera);

  if (ballMesh && ballBody) {
    // Atualiza a posição da câmara de cima por cima da bola
    miniMapCamera.position.set(
      ballBody.position.x,
      ballBody.position.y + 50, // Altura da vista aérea
      ballBody.position.z
    );
    miniMapCamera.lookAt(ballBody.position.x, ballBody.position.y, ballBody.position.z);

  }

  const originalViewport = {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };

  renderer.setViewport(originalViewport.x, originalViewport.y, originalViewport.width, originalViewport.height);
  renderer.setScissor(originalViewport.x, originalViewport.y, originalViewport.width, originalViewport.height);
  renderer.setScissorTest(false);
  renderer.render(scene, activeCamera);

  // Renderizar o mini mapa
  if (showMiniMap) {
    const minimapX = window.innerWidth - MINIMAP_SIZE - MINIMAP_PADDING;
    const minimapY = window.innerHeight - MINIMAP_SIZE - MINIMAP_PADDING;
    renderer.setViewport(minimapX, minimapY, MINIMAP_SIZE, MINIMAP_SIZE);
    renderer.setScissor(minimapX, minimapY, MINIMAP_SIZE, MINIMAP_SIZE);
    renderer.setScissorTest(true);
    renderer.render(scene, miniMapCamera);
    createMinimapBorder();
  }

  if (ballBody) {
    if (ballBody.position.distanceTo(sphere2.center) < sphere2.radius && !ballBody.In) {
      zoomOutCamera = true;

      if (ballBody.position.distanceTo(sphere.center) < sphere.radius && !ballBody.In) {
        ballBody.type = CANNON.Body.STATIC;
        ballBody.updateMassProperties();
        console.log("in");
        ballBody.In = true;
        activeCamera = topCamera;
        ballBody.sleep()
        canShoot = false;
        launchManyRockets();
        showMiniMap = false;
        if (minimapBorder) {
          minimapBorder.remove();
          minimapBorder = null;
        }
        stopClock();
        calcularPontos(strokes, 3, savedTimes[savedTimes.length - 1]);

        document.getElementById('strokes').textContent = `Tacadas: ${strokes}`;


        sleep(5000).then(() => {
          ballBody.type = CANNON.Body.DYNAMIC;
          ballBody.updateMassProperties();
          zoomOutCamera = false;
          ballBody.velocity.set(0, 0, 0);
          ballBody.angularVelocity.set(0, 0, 0);
          ballBody.position.set(0, 5, 0);
          ballBody.In = false;
          activeCamera = camera;
          canShoot = true;
          showMiniMap = true;

        });
      }
    } else {
      zoomOutCamera = false;
    }
  }

  if (ballBody) {
    const maxAngularVelocity = 150;
    if (ballBody.angularVelocity.length() > maxAngularVelocity) {
      ballBody.angularVelocity.scale(
        maxAngularVelocity / ballBody.angularVelocity.length(),
        ballBody.angularVelocity
      );
    }

    if (
      ballBody.position.distanceTo(sphere2.center) < sphere2.radius && !ballBody.In) {
      zoomOutCamera = true;

      if (ballBody.position.distanceTo(sphere.center) < sphere.radius && !ballBody.In) {
        ballBody.type = CANNON.Body.STATIC;
        ballBody.updateMassProperties();
        ballBody.In = true;
        activeCamera.current = topCamera;
        ballBody.sleep();
        canShoot = false;
        launchManyRockets(ballBody.position);

        setTimeout(() => {
          ballBody.type = CANNON.Body.DYNAMIC;
          ballBody.updateMassProperties();
          zoomOutCamera = false;
          ballBody.velocity.set(0, 0, 0);
          ballBody.angularVelocity.set(0, 0, 0);
          ballBody.position.set(0, 4.1, 0);
          ballBody.In = false;
          activeCamera.current = camera;
          canShoot = true;
        }, 5000);
      }
    } else {
      zoomOutCamera = false;
    }
  }
}

// ------------------------------
// Initialize & start animation
// ------------------------------
initBallPhysics();
loadMap();
createStreetLights();
setupInputControls();

document.getElementById('game-container').appendChild(renderer.domElement);

requestAnimationFrame(animate);