let canvas, gl, audioContext, analyser, dataArray;
let audioElement, playPauseBtn, volumeSlider, fileInput, fullscreenBtn;
let settings = {
    iterations: 200,
    zoom: 1,
    speed: 1,
    audioReactivity: 1,
    kaleidoscopeSegments: 6
};

let targetSettings = {...settings};
const transitionSpeed = 0.05;

const vertexShaderSource = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_zoom;
  uniform float u_iterations;
  uniform float u_audioReactivity;
  uniform float u_bassIntensity;
  uniform float u_midIntensity;
  uniform float u_highIntensity;
  uniform float u_kaleidoscopeSegments;

  #define PI 3.14159265359

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec2 kaleidoscope(vec2 uv, float segments) {
    float angle = atan(uv.y, uv.x);
    float radius = length(uv);
    angle = mod(angle, 2.0 * PI / segments);
    angle = abs(angle - PI / segments);
    return vec2(cos(angle), sin(angle)) * radius;
  }

  float julia(vec2 z, vec2 c) {
    for (float i = 0.0; i < 1000.0; i++) {
      if (i > u_iterations) return 0.0;
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      if (dot(z, z) > 4.0) return i / u_iterations;
    }
    return 0.0;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
    
    uv += vec2(sin(uv.y * 5.0 + u_time * 0.5), cos(uv.x * 5.0 + u_time * 0.5)) * 0.005;
    
    uv = kaleidoscope(uv, u_kaleidoscopeSegments);
    
    vec2 z = uv * 3.0 / u_zoom;
    vec2 c1 = vec2(
      0.285 + 0.01 * sin(u_time * 0.17),
      0.01 + 0.01 * cos(u_time * 0.23)
    );
    vec2 c2 = vec2(
      -0.4 + 0.1 * cos(u_time * 0.13),
      0.6 + 0.1 * sin(u_time * 0.19)
    );
    
    float f1 = julia(z, c1);
    float f2 = julia(z, c2);
    float f = mix(f1, f2, 0.5 + 0.5 * sin(u_time * 0.1));

    float hue = fract(f * 3.0 + u_time * 0.1 + u_bassIntensity * 0.2 + u_midIntensity * 0.1);
    float sat = 0.7 + 0.3 * sin(f * 20.0) + u_highIntensity * 0.3;
    float val = 0.6 + 0.4 * f + u_bassIntensity * 0.3;
    
    vec3 color = hsv2rgb(vec3(hue, sat, val));
    
    float glow = exp(-f * 2.5) * (0.3 + 0.1 * u_bassIntensity);
    color += glow * vec3(0.7, 0.5, 0.2);
    
    color += u_audioReactivity * u_bassIntensity * vec3(0.1, 0.0, 0.25);
    
    color *= 0.9 + 0.15 * sin(u_time * 2.0 + f * 10.0) * (1.0 + u_bassIntensity * u_audioReactivity);
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function setup() {
    canvas = document.getElementById('visualizer');
    gl = canvas.getContext('webgl');
    
    if (!gl) {
        showMessage('WebGL not supported', 'error');
        return;
    }

    setResolution();  // Set resolution initially to avoid blurry rendering

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);

    const uniformLocations = {
        resolution: gl.getUniformLocation(program, "u_resolution"),
        time: gl.getUniformLocation(program, "u_time"),
        zoom: gl.getUniformLocation(program, "u_zoom"),
        iterations: gl.getUniformLocation(program, "u_iterations"),
        audioReactivity: gl.getUniformLocation(program, "u_audioReactivity"),
        bassIntensity: gl.getUniformLocation(program, "u_bassIntensity"),
        midIntensity: gl.getUniformLocation(program, "u_midIntensity"),
        highIntensity: gl.getUniformLocation(program, "u_highIntensity"),
        kaleidoscopeSegments: gl.getUniformLocation(program, "u_kaleidoscopeSegments")
    };

    setupAudio();
    setupEventListeners();

    function animate(time) {
        smoothTransition();
        draw(time, uniformLocations);
        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

function setupAudio() {
    audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.loop = true;  // Loop the audio
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const source = audioContext.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioElement.addEventListener('ended', () => {
        playPauseBtn.textContent = 'Play';
    });

    audioElement.addEventListener('play', () => {
        playPauseBtn.textContent = 'Pause';
    });

    audioElement.addEventListener('pause', () => {
        playPauseBtn.textContent = 'Play';
    });

    audioElement.addEventListener('loadeddata', () => {
        if (!audioElement.paused) audioElement.play();
    });
}

function setupEventListeners() {
    playPauseBtn = document.getElementById('playPause');
    volumeSlider = document.getElementById('volume');
    fileInput = document.getElementById('fileInput');
    fullscreenBtn = document.getElementById('fullscreenBtn');

    playPauseBtn.addEventListener('click', togglePlayPause);
    volumeSlider.addEventListener('input', (e) => audioElement.volume = e.target.value);
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            audioElement.src = URL.createObjectURL(file);
        }
    });

    fullscreenBtn.addEventListener('click', toggleFullscreen);

    document.querySelectorAll('.controls input[type="range"]').forEach(input => {
        input.addEventListener('input', (e) => {
            targetSettings[e.target.id] = parseFloat(e.target.value);
        });
    });

    document.getElementById('toggleControls').addEventListener('click', toggleControls);

    window.addEventListener('resize', () => setResolution());

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            togglePlayPause();
            toggleControls();
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            toggleControls(false); // Ensure settings are hidden when exiting fullscreen
        }
    });
}

function togglePlayPause() {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    if (audioElement.paused) {
        audioElement.play();
    } else {
        audioElement.pause();
    }
}

function toggleControls(force) {
    const controlsOverlay = document.getElementById('controlsOverlay');
    if (typeof force === 'boolean') {
        controlsOverlay.classList.toggle('active', force);
    } else {
        controlsOverlay.classList.toggle('active');
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function smoothTransition() {
    for (let key in settings) {
        if (settings[key] !== targetSettings[key]) {
            settings[key] += (targetSettings[key] - settings[key]) * transitionSpeed;
        }
    }
}

function draw(time, uniformLocations) {
    gl.uniform2f(uniformLocations.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniformLocations.time, time * 0.001 * settings.speed);
    gl.uniform1f(uniformLocations.zoom, settings.zoom);
    gl.uniform1f(uniformLocations.iterations, settings.iterations);
    gl.uniform1f(uniformLocations.audioReactivity, settings.audioReactivity);
    gl.uniform1f(uniformLocations.kaleidoscopeSegments, settings.kaleidoscopeSegments);
    
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const bassIntensity = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
        const midIntensity = dataArray.slice(4, 12).reduce((a, b) => a + b, 0) / (8 * 255);
        const highIntensity = dataArray.slice(12, 32).reduce((a, b) => a + b, 0) / (20 * 255);
        gl.uniform1f(uniformLocations.bassIntensity, bassIntensity);
        gl.uniform1f(uniformLocations.midIntensity, midIntensity);
        gl.uniform1f(uniformLocations.highIntensity, highIntensity);
    } else {
        gl.uniform1f(uniformLocations.bassIntensity, 0);
        gl.uniform1f(uniformLocations.midIntensity, 0);
        gl.uniform1f(uniformLocations.highIntensity, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setResolution(scale = 1) {
    const dpi = window.devicePixelRatio || 1;
    const width = window.innerWidth * scale;
    const height = window.innerHeight * scale;
    canvas.width = width * dpi;
    canvas.height = height * dpi;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function showMessage(message, type = 'info') {
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
    document.body.appendChild(messageElement);
    setTimeout(() => messageElement.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', setup);



