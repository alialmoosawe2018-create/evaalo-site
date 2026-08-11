import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useDesign } from '../contexts/DesignContext';
import '../design-styles.css';

const Workflow = () => {
    const { questions } = useDesign();
    const [saved, setSaved] = useState(false);
    const [nodes, setNodes] = useState([]);
    const [draggedNode, setDraggedNode] = useState(null);
    const [draggedQuestion, setDraggedQuestion] = useState(null);
    const [dragOverNode, setDragOverNode] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [selectedNodes, setSelectedNodes] = useState(new Set());
    const [isSelectMode, setIsSelectMode] = useState(true);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const canvasRef = useRef(null);
    const canvasContentRef = useRef(null);
    const animationFrameRef = useRef(null);
    

    // Save to history
    const saveToHistory = (newNodes) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.parse(JSON.stringify(newNodes)));
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    };

    // Undo
    const handleUndo = () => {
        if (historyIndex > 0) {
            const prevIndex = historyIndex - 1;
            setHistoryIndex(prevIndex);
            setNodes(JSON.parse(JSON.stringify(history[prevIndex])));
        }
    };

    // Redo
    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const nextIndex = historyIndex + 1;
            setHistoryIndex(nextIndex);
            setNodes(JSON.parse(JSON.stringify(history[nextIndex])));
        }
    };

    useEffect(() => {
        // Sync nodes with questions when questions change
        if (questions.length > 0) {
            setNodes(prevNodes => {
                // Get current question IDs
                const currentQuestionIds = questions.map((q, index) => q.id || index);
                
                // Remove nodes for deleted questions
                const filteredNodes = prevNodes.filter(node => currentQuestionIds.includes(node.questionId));
                
                // Find new questions that don't have nodes yet
                const existingQuestionIds = filteredNodes.map(n => n.questionId);
                const newQuestions = questions.filter((q, index) => {
                    const questionId = q.id || index;
                    return !existingQuestionIds.includes(questionId);
                });

                // Create nodes for new questions
                const newNodes = newQuestions.map((question, index) => ({
                    id: question.id || `node-${Date.now()}-${index}`,
                    questionId: question.id || questions.indexOf(question),
                    text: question.text || question.question || `Question ${questions.indexOf(question) + 1}`,
                    type: question.type || 'short-text',
                    x: 100 + (questions.indexOf(question) % 3) * 300,
                    y: 100 + Math.floor(questions.indexOf(question) / 3) * 200,
                    connections: []
                }));

                const updatedNodes = [...filteredNodes, ...newNodes];
                // Save to history when questions change
                if (newQuestions.length > 0 || filteredNodes.length !== prevNodes.length) {
                    setTimeout(() => saveToHistory(updatedNodes), 100);
                }
                return updatedNodes;
            });
        } else {
            // Clear nodes if no questions
            setNodes([]);
            saveToHistory([]);
        }
    }, [questions]);

    // Save to history when nodes change (except from undo/redo)
    useEffect(() => {
        if (nodes.length > 0 && history.length > 0) {
            const currentState = JSON.stringify(nodes);
            const lastState = JSON.stringify(history[historyIndex]);
            if (currentState !== lastState && !draggedNode) {
                // Debounce history saves
                const timeoutId = setTimeout(() => {
                    const newHistory = history.slice(0, historyIndex + 1);
                    newHistory.push(JSON.parse(JSON.stringify(nodes)));
                    setHistory(newHistory);
                    setHistoryIndex(newHistory.length - 1);
                }, 300);
                return () => clearTimeout(timeoutId);
            }
        }
    }, [nodes, history, historyIndex, draggedNode]);

    // Keyboard shortcuts for Undo/Redo
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (historyIndex > 0) {
                    const prevIndex = historyIndex - 1;
                    setHistoryIndex(prevIndex);
                    setNodes(JSON.parse(JSON.stringify(history[prevIndex])));
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                if (historyIndex < history.length - 1) {
                    const nextIndex = historyIndex + 1;
                    setHistoryIndex(nextIndex);
                    setNodes(JSON.parse(JSON.stringify(history[nextIndex])));
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [historyIndex, history]);

    // Global mouse events for panning (to work even when mouse leaves canvas)
    useEffect(() => {
        if (isPanning) {
            const handleGlobalMouseMove = (e) => {
                if (isPanning && !draggedNode && !draggedQuestion) {
                    setPanOffset({
                        x: e.clientX - panStart.x,
                        y: e.clientY - panStart.y
                    });
                }
            };

            const handleGlobalMouseUp = () => {
                setIsPanning(false);
            };

            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
            
            return () => {
                window.removeEventListener('mousemove', handleGlobalMouseMove);
                window.removeEventListener('mouseup', handleGlobalMouseUp);
            };
        }
    }, [isPanning, panStart, draggedNode, draggedQuestion]);

    // Pan functionality (drag canvas to move)
    const handleCanvasMouseDown = (e) => {
        // Don't pan if clicking on toolbar, buttons, or nodes
        if (e.target.closest('.workflow-canvas-toolbar') || 
            e.target.closest('.workflow-node') || 
            e.target.closest('button')) {
            return;
        }
        
        if (e.button === 0 && !draggedNode && !draggedQuestion) {
            // If clicking on empty space and in select mode, deselect all
            if (isSelectMode && (e.target === canvasRef.current || e.target === canvasContentRef.current || e.target.closest('.workflow-canvas-content'))) {
                setSelectedNodes(new Set());
            }
            
            // Only pan if not in select mode or if space key is held
            if (!isSelectMode || e.shiftKey) {
                setIsPanning(true);
                setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
                e.preventDefault();
                e.stopPropagation();
            }
        }
    };

    const handleCanvasMouseMove = (e) => {
        if (isPanning && !draggedNode && !draggedQuestion) {
            setPanOffset({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y
            });
        }
    };

    const handleCanvasMouseUp = () => {
        setIsPanning(false);
    };

    // Zoom functionality (mouse wheel)
    const handleCanvasWheel = useCallback((e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.max(0.5, Math.min(2, z * delta)));
    }, []);

    // Bound natively: React registers wheel listeners as passive, so preventDefault
    // from an onWheel prop is ignored and Ctrl+wheel zooms the browser page too.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        el.addEventListener('wheel', handleCanvasWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleCanvasWheel);
    }, [handleCanvasWheel]);

    // Zoom controls from toolbar
    const handleZoomIn = () => {
        setZoom(prev => Math.min(2, prev * 1.2));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(0.5, prev / 1.2));
    };

    const handleResetZoom = () => {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
    };

    // Select mode toggle
    const handleSelectModeToggle = () => {
        setIsSelectMode(true);
        setSelectedNodes(new Set());
        setIsPanning(false);
    };

    // Pan mode toggle
    const handlePanModeToggle = () => {
        setIsSelectMode(false);
        setSelectedNodes(new Set());
        setIsPanning(false);
    };

    // Toggle node selection
    const handleNodeClick = (nodeId, e) => {
        if (isSelectMode && !draggedNode) {
            e.stopPropagation();
            setSelectedNodes(prev => {
                const newSet = new Set(prev);
                if (newSet.has(nodeId)) {
                    newSet.delete(nodeId);
                } else {
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        newSet.add(nodeId);
                    } else {
                        return new Set([nodeId]);
                    }
                }
                return newSet;
            });
        }
    };

    // Horizontal Align - align selected nodes horizontally
    const handleHorizontalAlign = () => {
        const nodesToAlign = selectedNodes.size > 0 
            ? nodes.filter(n => selectedNodes.has(n.id))
            : nodes;
        
        if (nodesToAlign.length === 0) return;
        
        // Find the center Y position of selected nodes
        const centerY = nodesToAlign.reduce((sum, node) => sum + node.y, 0) / nodesToAlign.length;
        
        // Align selected nodes to the same Y position
        setNodes(prevNodes => 
            prevNodes.map(node => {
                if (selectedNodes.size > 0 && !selectedNodes.has(node.id)) {
                    return node;
                }
                return {
                    ...node,
                    y: centerY
                };
            })
        );
    };

    // Vertical Align - align selected nodes vertically
    const handleVerticalAlign = () => {
        const nodesToAlign = selectedNodes.size > 0 
            ? nodes.filter(n => selectedNodes.has(n.id))
            : nodes;
        
        if (nodesToAlign.length === 0) {
            console.log('No nodes to align');
            return;
        }
        
        // Find the center X position of selected nodes
        const centerX = nodesToAlign.reduce((sum, node) => sum + node.x, 0) / nodesToAlign.length;
        
        // Align selected nodes to the same X position
        setNodes(prevNodes => 
            prevNodes.map(node => {
                if (selectedNodes.size > 0 && !selectedNodes.has(node.id)) {
                    return node;
                }
                return {
                    ...node,
                    x: centerX
                };
            })
        );
        
        console.log(`Aligned ${nodesToAlign.length} nodes vertically at X: ${centerX}`);
    };

    const handleResetLayout = () => {
        if (window.confirm('Are you sure you want to reset the layout? This will clear all workflow connections.')) {
            setNodes([]);
            console.log('Layout reset');
        }
    };

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        console.log('Workflow saved', nodes);
    };

    const nodeDragOffset = useRef({ x: 0, y: 0 });
    const lastUpdateTime = useRef(0);

    const handleNodeDragStart = (nodeId, e) => {
        setDraggedNode(nodeId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        
        // Store initial mouse position relative to node
        if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
                const scrollLeft = canvasRef.current.scrollLeft || 0;
                const scrollTop = canvasRef.current.scrollTop || 0;
                nodeDragOffset.current = {
                    x: e.clientX - rect.left + scrollLeft - node.x,
                    y: e.clientY - rect.top + scrollTop - node.y
                };
            }
        }
        
        // Cancel any pending animation frame
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
    };

    const handleNodeDrag = (e, nodeId) => {
        if (draggedNode === nodeId && canvasRef.current && e.clientX && e.clientY) {
            const now = performance.now();
            
            // Throttle updates to ~60fps
            if (now - lastUpdateTime.current < 16) {
                return;
            }
            lastUpdateTime.current = now;
            
            // Cancel previous animation frame
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            
            // Use requestAnimationFrame for smooth updates
            animationFrameRef.current = requestAnimationFrame(() => {
                const rect = canvasRef.current.getBoundingClientRect();
                const x = (e.clientX - rect.left - panOffset.x) / zoom - nodeDragOffset.current.x;
                const y = (e.clientY - rect.top - panOffset.y) / zoom - nodeDragOffset.current.y;
                
                setNodes(prevNodes => 
                    prevNodes.map(node => 
                        node.id === nodeId 
                            ? { 
                                ...node, 
                                x: Math.max(20, x), 
                                y: Math.max(20, y)
                            }
                            : node
                    )
                );
            });
        }
    };

    const handleNodeDragEnd = () => {
        // Cancel any pending animation frame
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        
        setDraggedNode(null);
        nodeDragOffset.current = { x: 0, y: 0 };
        lastUpdateTime.current = 0;
    };

    const handleAddNodeToCanvas = (question, x, y) => {
        const newNode = {
            id: question.id || `node-${Date.now()}`,
            questionId: question.id || questions.indexOf(question),
            text: question.text || question.question || 'New Question',
            type: question.type || 'short-text',
            x: x || 200 + Math.random() * 200,
            y: y || 200 + Math.random() * 200,
            connections: []
        };
        setNodes(prev => {
            const updated = [...prev, newNode];
            setTimeout(() => saveToHistory(updated), 100);
            return updated;
        });
    };

    const handleQuestionDragStart = (question, e) => {
        setDraggedQuestion(question);
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify(question));
        
        // Create a custom drag preview element
        const questionElement = e.currentTarget;
        const rect = questionElement.getBoundingClientRect();
        
        // Create a new element that matches the question item style
        const dragPreview = document.createElement('div');
        dragPreview.className = 'workflow-question-item';
        dragPreview.style.cssText = `
            position: absolute;
            top: -1000px;
            left: -1000px;
            width: ${rect.width}px;
            opacity: 0.95;
            pointer-events: none;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: rgba(15, 23, 42, 0.95);
            border-radius: 8px;
            border: 1px solid rgba(56, 189, 248, 0.5);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        `;
        
        // Add question number
        const numberSpan = document.createElement('span');
        numberSpan.className = 'workflow-question-number';
        numberSpan.textContent = (questions.indexOf(question) + 1).toString();
        dragPreview.appendChild(numberSpan);
        
        // Add question text
        const textSpan = document.createElement('span');
        textSpan.className = 'workflow-question-text';
        textSpan.textContent = question.text || question.question || 'Untitled Question';
        dragPreview.appendChild(textSpan);
        
        document.body.appendChild(dragPreview);
        
        // Calculate offset to center the preview on cursor
        const offsetX = rect.width / 2;
        const offsetY = rect.height / 2;
        
        e.dataTransfer.setDragImage(dragPreview, offsetX, offsetY);
        
        // Clean up immediately after setting drag image
        requestAnimationFrame(() => {
            if (document.body.contains(dragPreview)) {
                document.body.removeChild(dragPreview);
            }
        });
    };

    const handleQuestionDragEnd = () => {
        setDraggedQuestion(null);
        setIsDragging(false);
        setDragOverNode(null);
    };

    const handleCanvasDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        
        if (draggedQuestion && canvasRef.current && !draggedNode && !isPanning) {
            // Update drag position for visual feedback (accounting for pan and zoom)
            const rect = canvasRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left - panOffset.x) / zoom;
            const y = (e.clientY - rect.top - panOffset.y) / zoom;
            setDragPosition({ x, y });
            
            // Check if dragging over a node (with padding for easier drop)
            const padding = 40;
            const overNode = nodes.find(node => {
                const nodeRect = {
                    left: node.x - padding,
                    top: node.y - padding,
                    right: node.x + 200 + padding,
                    bottom: node.y + 120 + padding
                };
                return x >= nodeRect.left && x <= nodeRect.right && 
                       y >= nodeRect.top && y <= nodeRect.bottom;
            });
            
            setDragOverNode(overNode || null);
        }
    };

    const handleCanvasDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (draggedQuestion && canvasRef.current && !draggedNode && !isPanning) {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left - panOffset.x) / zoom - 100; // Center the node
            const y = (e.clientY - rect.top - panOffset.y) / zoom - 60;
            
            // Check if dropped on a node (to create connection)
            const padding = 50;
            const targetNode = nodes.find(node => {
                const nodeRect = {
                    left: node.x - padding,
                    top: node.y - padding,
                    right: node.x + 200 + padding,
                    bottom: node.y + 120 + padding
                };
                return x >= nodeRect.left && x <= nodeRect.right && 
                       y >= nodeRect.top && y <= nodeRect.bottom;
            });
            
            if (targetNode) {
                // Create connection
                const questionId = draggedQuestion.id || questions.indexOf(draggedQuestion);
                const targetQuestionId = targetNode.questionId;
                
                // Don't connect to itself
                if (questionId !== targetQuestionId) {
                    setNodes(prev => prev.map(node => 
                        node.id === targetNode.id 
                            ? { 
                                ...node, 
                                connections: [...(node.connections || []).filter(c => c !== questionId), questionId]
                            }
                            : node
                    ));
                }
            } else {
                // Add new node - no limits on position
                const questionId = draggedQuestion.id || questions.indexOf(draggedQuestion);
                const exists = nodes.some(n => n.questionId === questionId);
                if (!exists) {
                    handleAddNodeToCanvas(
                        draggedQuestion, 
                        Math.max(20, x), 
                        Math.max(20, y)
                    );
                }
            }
        }
        
        handleQuestionDragEnd();
    };

    const handleNodeDrop = (targetNodeId, e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (draggedQuestion && !draggedNode) {
            const questionId = draggedQuestion.id || questions.indexOf(draggedQuestion);
            const targetNode = nodes.find(n => n.id === targetNodeId);
            const targetQuestionId = targetNode?.questionId;
            
            // Don't connect to itself
            if (questionId !== targetQuestionId) {
                setNodes(prev => prev.map(node => 
                    node.id === targetNodeId 
                        ? { 
                            ...node, 
                            connections: [...(node.connections || []).filter(c => c !== questionId), questionId]
                        }
                        : node
                ));
            }
        }
        
        handleQuestionDragEnd();
    };

    return (
        <div className="design-page workflow-page">
            <div className="design-background" aria-hidden="true">
                <div className="gradient-orb design-orb-1"></div>
                <div className="gradient-orb design-orb-2"></div>
                <div className="gradient-orb design-orb-3"></div>
            </div>

            <div className="design-container">
                <div className="design-header">
                    <div className="header-content">
                        <h1 className="design-title">Workflow Builder</h1>
                        <p className="design-subtitle">Design question flow based on answers (Typeform-style)</p>
                    </div>
                    <div className="header-actions">
                        <button type="button" className="btn btn-secondary" onClick={handleResetLayout}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path
                                    d="M4.16667 9.16667C4.16667 6.40525 6.40525 4.16667 9.16667 4.16667C11.9281 4.16667 14.1667 6.40525 14.1667 9.16667C14.1667 11.9281 11.9281 14.1667 9.16667 14.1667C7.23858 14.1667 5.59538 12.9281 4.92805 11.25"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                    strokeLinecap="round"
                                />
                                <path d="M4.16667 4.16667V9.16667H9.16667" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="btn-text">Reset Layout</span>
                        </button>
                        <button type="button" className="btn btn-primary" onClick={handleSave}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M15.8333 17.5H4.16667C3.25 17.5 2.5 16.75 2.5 15.8333V4.16667C2.5 3.25 3.25 2.5 4.16667 2.5H13.3333L17.5 6.66667V15.8333C17.5 16.75 16.75 17.5 15.8333 17.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M13.3333 17.5V11.6667H6.66667V17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M6.66667 2.5V6.66667H12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="btn-text">{saved ? 'Saved!' : 'Save'}</span>
                        </button>
                    </div>
                </div>

                <div className="workflow-main-container">
                    <div className="workflow-builder-container">
                    {/* Left Sidebar */}
                    <div className="workflow-sidebar">
                        <div className="workflow-sidebar-content">
                                <div className="workflow-questions-list">
                                    {questions.length === 0 ? (
                                    <div>
                                        <p className="workflow-empty-text">No questions yet.</p>
                                    </div>
                                    ) : (
                                        <div className="workflow-questions">
                                        {questions.map((question, index) => {
                                            const isOnCanvas = nodes.some(n => n.questionId === (question.id || index));
                                            return (
                                                <div 
                                                    key={question.id || `q-${index}`} 
                                                    className={`workflow-question-item ${isOnCanvas ? 'on-canvas' : ''} ${draggedQuestion?.id === question.id ? 'dragging' : ''}`}
                                                    draggable={!isOnCanvas}
                                                    onDragStart={(e) => handleQuestionDragStart(question, e)}
                                                    onDragEnd={handleQuestionDragEnd}
                                                >
                                                    <span className="workflow-question-number">{index + 1}</span>
                                                    <span className="workflow-question-text">{question.text || question.question || 'Untitled Question'}</span>
                                                    {isOnCanvas && (
                                                        <span className="workflow-question-badge">✓</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        </div>
                                    )}
                                </div>
                        </div>
                    </div>

                    {/* Main Canvas Area */}
                    <div 
                        className={`workflow-canvas ${isDragging ? 'dragging' : ''} ${isPanning ? 'panning' : ''}`} 
                        ref={canvasRef}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                        onDragOver={handleCanvasDragOver}
                        onDrop={handleCanvasDrop}
                        style={{ cursor: isPanning ? 'grabbing' : (!isSelectMode ? 'grab' : 'default') }}
                    >
                        {/* Canvas Toolbar */}
                        <div className="workflow-canvas-toolbar">
                            <button 
                                className={`workflow-toolbar-btn ${isSelectMode ? 'active' : ''}`} 
                                title="Select Tool (Click nodes to select)"
                                onClick={handleSelectModeToggle}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 2L12.5 7L17.5 8.75L14.5 12.5L15.5 17.5L10 15L4.5 17.5L5.5 12.5L2.5 8.75L7.5 7L10 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                                    <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
                                </svg>
                            </button>
                            <button className="workflow-toolbar-btn" title="Lock Nodes (Coming Soon)">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="4" y="8" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
                                    <path d="M6 8V5C6 3.34315 7.34315 2 9 2H11C12.6569 2 14 3.34315 14 5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                                </svg>
                            </button>
                            <button 
                                className="workflow-toolbar-btn workflow-toolbar-btn-undo" 
                                title="Undo (Ctrl+Z)"
                                onClick={handleUndo}
                                disabled={historyIndex <= 0}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M5 10C5 7.23858 7.23858 5 10 5C12.7614 5 15 7.23858 15 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                    <path d="M8 7L5 10L8 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <button 
                                className="workflow-toolbar-btn workflow-toolbar-btn-redo" 
                                title="Redo (Ctrl+Y)"
                                onClick={handleRedo}
                                disabled={historyIndex >= history.length - 1}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15 10C15 12.7614 12.7614 15 10 15C7.23858 15 5 12.7614 5 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                    <path d="M12 7L15 10L12 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <div className="workflow-toolbar-divider"></div>
                            <button className="workflow-toolbar-btn workflow-toolbar-btn-align" title="Vertical Align" onClick={handleVerticalAlign}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 2V18M10 2L6 6M10 2L14 6M10 18L6 14M10 18L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <button className="workflow-toolbar-btn workflow-toolbar-btn-align" title="Horizontal Align" onClick={handleHorizontalAlign}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M2 10H18M2 10L6 6M2 10L6 14M18 10L14 6M18 10L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </button>
                            <div className="workflow-toolbar-divider"></div>
                            <button className="workflow-toolbar-btn workflow-toolbar-btn-zoom" title="Zoom Out (Ctrl + Scroll)" onClick={handleZoomOut}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.8"/>
                                    <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                    <path d="M6 9H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                            </button>
                            <button className="workflow-toolbar-btn workflow-toolbar-btn-zoom" title="Zoom In (Ctrl + Scroll)" onClick={handleZoomIn}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.8"/>
                                    <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                    <path d="M9 6V12M6 9H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                            </button>
                            <div className="workflow-toolbar-divider"></div>
                            <button 
                                className={`workflow-toolbar-btn ${!isSelectMode ? 'active' : ''}`} 
                                title="Pan Tool (Drag canvas to move)"
                                onClick={handlePanModeToggle}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 2L12 7L17 9L12 11L10 16L8 11L3 9L8 7L10 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                                    <circle cx="10" cy="9" r="1.5" fill="currentColor"/>
                                </svg>
                            </button>
                            <div className="workflow-toolbar-zoom-info">
                                {Math.round(zoom * 100)}%
                            </div>
                        </div>

                        {/* Always render canvas content for pan/zoom even when empty */}
                        <div 
                            className="workflow-canvas-content"
                            ref={canvasContentRef}
                            onMouseDown={(e) => {
                                // Allow panning from canvas content as well
                                if (!e.target.closest('.workflow-node') && !e.target.closest('button')) {
                                    handleCanvasMouseDown(e);
                                }
                            }}
                            style={{
                                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                                transformOrigin: '0 0',
                                transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                                cursor: isPanning ? 'grabbing' : (!isSelectMode ? 'grab' : 'default')
                            }}
                        >
                            {questions.length === 0 ? (
                                <div className="workflow-empty-state">
                                    <div className="workflow-empty-content">
                                        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: '24px', opacity: 0.5 }}>
                                            <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4"/>
                                            <path d="M40 20V40M40 40L50 50" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                        </svg>
                                        <p className="workflow-empty-message">
                                            No questions yet. Go to <Link to="/design" className="workflow-design-link">Design</Link> and add questions.
                                        </p>
                                    </div>
                                </div>
                            ) : nodes.length === 0 ? (
                                <div className="workflow-empty-state">
                                    <div className="workflow-empty-content">
                                        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: '24px', opacity: 0.5 }}>
                                            <rect x="20" y="20" width="40" height="40" rx="8" stroke="currentColor" strokeWidth="2"/>
                                            <path d="M30 35H50M30 40H45M30 45H50" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                        </svg>
                                        <p className="workflow-empty-message">
                                            Drag questions from the sidebar to build your workflow
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                {/* SVG for connections */}
                                <svg className="workflow-connections" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
                                    {nodes.map((node, index) => {
                                        if (index < nodes.length - 1) {
                                            const nextNode = nodes[index + 1];
                                            return (
                                                <line
                                                    key={`connection-${node.id}-${nextNode.id}`}
                                                    x1={node.x + 100}
                                                    y1={node.y + 40}
                                                    x2={nextNode.x + 100}
                                                    y2={nextNode.y + 40}
                                                    stroke="rgba(56, 189, 248, 0.4)"
                                                    strokeWidth="2"
                                                    strokeDasharray="5,5"
                                                    markerEnd="url(#arrowhead)"
                                                />
                                            );
                                        }
                                        return null;
                                    })}
                                    <defs>
                                        <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                                            <polygon points="0 0, 10 3, 0 6" fill="rgba(56, 189, 248, 0.6)" />
                                        </marker>
                                    </defs>
                                </svg>
                                
                                {/* Workflow Nodes */}
                                {nodes.map((node) => (
                                    <div
                                        key={node.id}
                                        className={`workflow-node ${dragOverNode?.id === node.id ? 'drag-over' : ''} ${selectedNodes.has(node.id) ? 'selected' : ''}`}
                                        style={{
                                            position: 'absolute',
                                            left: `${node.x}px`,
                                            top: `${node.y}px`,
                                            zIndex: selectedNodes.has(node.id) ? 3 : 2
                                        }}
                                        draggable
                                        onClick={(e) => handleNodeClick(node.id, e)}
                                        onDragStart={(e) => {
                                            e.stopPropagation();
                                            handleNodeDragStart(node.id, e);
                                        }}
                                        onDrag={(e) => {
                                            if (e.clientX && e.clientY) {
                                                handleNodeDrag(e, node.id);
                                            }
                                        }}
                                        onDragEnd={(e) => {
                                            e.stopPropagation();
                                            handleNodeDragEnd();
                                        }}
                                        onDragOver={(e) => {
                                            if (draggedQuestion && !draggedNode) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setDragOverNode(node);
                                            }
                                        }}
                                        onDragLeave={(e) => {
                                            if (!e.currentTarget.contains(e.relatedTarget)) {
                                                setDragOverNode(null);
                                            }
                                        }}
                                        onDrop={(e) => handleNodeDrop(node.id, e)}
                                    >
                                        <div className="workflow-node-header">
                                            <div className="workflow-node-icon">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M10 2L12.5 7L17.5 8.75L14.5 12.5L15.5 17.5L10 15L4.5 17.5L5.5 12.5L2.5 8.75L7.5 7L10 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                                                </svg>
                                            </div>
                                            <span className="workflow-node-type">{node.type}</span>
                                        </div>
                                        <div className="workflow-node-content">
                                            <p className="workflow-node-text">{node.text}</p>
                                        </div>
                                        <div className="workflow-node-handle"></div>
                                    </div>
                                ))}
                                </div>
                            )}
                        </div>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Workflow;

