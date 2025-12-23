import React, { useEffect, useRef } from 'react';

const NeuralNetwork = () => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const particlesRef = useRef([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const particleCount = 50;
        const maxDistance = 150;

        const getRandomColor = () => {
            const colors = [
                'rgba(56, 189, 248, 0.6)',
                'rgba(168, 85, 247, 0.6)',
                'rgba(34, 211, 238, 0.6)',
                'rgba(192, 132, 252, 0.6)'
            ];
            return colors[Math.floor(Math.random() * colors.length)];
        };

        const resizeCanvas = () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        };

        resizeCanvas();

        // Create particles
        particlesRef.current = [];
        for (let i = 0; i < particleCount; i++) {
            particlesRef.current.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                color: getRandomColor()
            });
        }

        const drawParticle = (particle) => {
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            ctx.fillStyle = particle.color;
            ctx.fill();
            ctx.shadowBlur = 10;
            ctx.shadowColor = particle.color;
        };

        const drawLine = (p1, p2, distance) => {
            const opacity = (1 - distance / maxDistance) * 0.5;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(56, 189, 248, ${opacity})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particlesRef.current.forEach((particle, i) => {
                particle.x += particle.vx;
                particle.y += particle.vy;

                if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
                if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

                particle.x = Math.max(0, Math.min(canvas.width, particle.x));
                particle.y = Math.max(0, Math.min(canvas.height, particle.y));

                drawParticle(particle);

                for (let j = i + 1; j < particlesRef.current.length; j++) {
                    const p2 = particlesRef.current[j];
                    const dx = particle.x - p2.x;
                    const dy = particle.y - p2.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < maxDistance) {
                        drawLine(particle, p2, distance);
                    }
                }
            });

            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        const handleResize = () => {
            resizeCanvas();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    return <canvas ref={canvasRef} id="neuralNetwork" className="neural-network"></canvas>;
};

export default NeuralNetwork;

