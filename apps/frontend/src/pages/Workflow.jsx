import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDesign } from '../contexts/DesignContext';
import '../design-styles.css';

const Workflow = () => {
    const navigate = useNavigate();
    const { questions, deleteQuestion } = useDesign();
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
    const [editingNodeId, setEditingNodeId] = useState(null);
    const [showBranchModal, setShowBranchModal] = useState(false);
    const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);
    const [sourceNodeForAdd, setSourceNodeForAdd] = useState(null);
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
                    connections: [],
                    branches: [] // Array of { answer: string, nextQuestionId: number }
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
    const handleCanvasWheel = (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.5, Math.min(2, zoom * delta));
            setZoom(newZoom);
        }
    };

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

    // Fit to view - adjust zoom and pan to show all nodes
    const fitToView = () => {
        if (nodes.length === 0 || !canvasRef.current) {
            return;
        }

        const canvasRect = canvasRef.current.getBoundingClientRect();
        const padding = 100; // Padding around nodes
        
        // Calculate bounding box of all nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        nodes.forEach(node => {
            const nodeWidth = 200; // Node width
            const nodeHeight = 120; // Node height
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + nodeWidth);
            maxY = Math.max(maxY, node.y + nodeHeight);
        });

        // Add padding
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // Calculate zoom to fit content
        const zoomX = (canvasRect.width - 40) / contentWidth;
        const zoomY = (canvasRect.height - 40) / contentHeight;
        const newZoom = Math.max(0.3, Math.min(zoomX, zoomY, 2)); // Min zoom 0.3, Max zoom 2

        // Calculate pan offset to center content
        const scaledWidth = contentWidth * newZoom;
        const scaledHeight = contentHeight * newZoom;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        const newPanX = canvasRect.width / 2 - centerX * newZoom;
        const newPanY = canvasRect.height / 2 - centerY * newZoom;

        setZoom(newZoom);
        setPanOffset({ x: newPanX, y: newPanY });
    };

    // Select mode toggle
    const handleSelectModeToggle = () => {
        setIsSelectMode(true);
        setSelectedNodes(new Set());
        setIsPanning(false);
        // Fit to view when clicking select tool
        fitToView();
    };

    // Pan mode toggle
    const handlePanModeToggle = () => {
        setIsSelectMode(false);
        setSelectedNodes(new Set());
        setIsPanning(false);
    };

    // Toggle node selection
    const handleNodeClick = (nodeId, e) => {
        // Don't select if we just finished dragging
        if (isDraggingNode.current) {
            return;
        }
        
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

    // Handle double click to open branch editor
    const handleNodeDoubleClick = (nodeId, e) => {
        e.stopPropagation();
        setEditingNodeId(nodeId);
        setShowBranchModal(true);
    };

    // Save branches for a node
    const handleSaveBranches = (nodeId, branches) => {
        setNodes(prevNodes => {
            const updated = prevNodes.map(node => {
                if (node.id === nodeId) {
                    // Update branches
                    const updatedBranches = branches || [];
                    
                    // Update connections based on branches
                    const newConnections = updatedBranches
                        .map(branch => branch.nextQuestionId)
                        .filter(id => id !== null && id !== undefined);
                    
                    return {
                        ...node,
                        branches: updatedBranches,
                        connections: newConnections
                    };
                }
                return node;
            });
            setTimeout(() => saveToHistory(updated), 100);
            return updated;
        });
        setShowBranchModal(false);
        setEditingNodeId(null);
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

    const handleBackToDesigner = () => {
        navigate('/design');
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
    const isDraggingNode = useRef(false);

    // Mouse-based drag handlers (instead of HTML5 drag and drop to avoid ghost image)
    const handleNodeMouseDown = (nodeId, e) => {
        // Only start dragging on left mouse button
        if (e.button !== 0) return;
        
        // Don't drag if clicking on buttons or interactive elements
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) {
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        setDraggedNode(nodeId);
        isDraggingNode.current = true;
        
        // Store initial mouse position relative to node (accounting for pan and zoom)
        if (canvasRef.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
                // Calculate the actual position on screen considering pan and zoom
                const nodeScreenX = (node.x * zoom) + panOffset.x;
                const nodeScreenY = (node.y * zoom) + panOffset.y;
                
                // Calculate offset from mouse to node top-left corner
                nodeDragOffset.current = {
                    x: (e.clientX - canvasRect.left - nodeScreenX) / zoom,
                    y: (e.clientY - canvasRect.top - nodeScreenY) / zoom
                };
            }
        }
    };

    // Global mouse move handler for node dragging
    useEffect(() => {
        if (draggedNode && isDraggingNode.current) {
            const handleGlobalMouseMove = (e) => {
                if (!canvasRef.current) return;
                
                const rect = canvasRef.current.getBoundingClientRect();
                // Calculate position accounting for pan and zoom
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Convert screen coordinates to canvas coordinates
                const canvasX = (mouseX - panOffset.x) / zoom;
                const canvasY = (mouseY - panOffset.y) / zoom;
                
                // Apply the drag offset
                const x = canvasX - nodeDragOffset.current.x;
                const y = canvasY - nodeDragOffset.current.y;
                
                setNodes(prevNodes => 
                    prevNodes.map(node => 
                        node.id === draggedNode 
                            ? { 
                                ...node, 
                                x: Math.max(20, x), 
                                y: Math.max(20, y)
                            }
                            : node
                    )
                );
            };

            const handleGlobalMouseUp = () => {
                setDraggedNode(null);
                isDraggingNode.current = false;
                nodeDragOffset.current = { x: 0, y: 0 };
            };

            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
            
            return () => {
                window.removeEventListener('mousemove', handleGlobalMouseMove);
                window.removeEventListener('mouseup', handleGlobalMouseUp);
            };
        }
    }, [draggedNode, panOffset, zoom, nodes]);

    const handleAddNodeToCanvas = (question, x, y) => {
        const newNode = {
            id: question.id || `node-${Date.now()}`,
            questionId: question.id || questions.indexOf(question),
            text: question.text || question.question || 'New Question',
            type: question.type || 'short-text',
            x: x || 200 + Math.random() * 200,
            y: y || 200 + Math.random() * 200,
            connections: [],
            branches: [] // Array of { answer: string, nextQuestionId: number }
        };
        setNodes(prev => {
            const updated = [...prev, newNode];
            setTimeout(() => saveToHistory(updated), 100);
            return updated;
        });
    };

    // Handle adding question to canvas via button click
    const handleAddQuestionToCanvas = (question, e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const questionId = question.id || questions.indexOf(question);
        const exists = nodes.some(n => n.questionId === questionId);
        
        if (!exists) {
            // Add to center of visible canvas area
            const centerX = 300 + Math.random() * 200;
            const centerY = 200 + Math.random() * 200;
            handleAddNodeToCanvas(question, centerX, centerY);
        }
    };

    // Handle deleting question from sidebar
    const handleDeleteQuestion = (question, e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const questionIndex = questions.findIndex((q, idx) => {
            const qId = q.id || idx;
            const questionId = question.id || questions.indexOf(question);
            return qId === questionId;
        });
        
        if (questionIndex >= 0) {
            // Also remove node from canvas if it exists
            const questionId = question.id || questionIndex;
            setNodes(prevNodes => prevNodes.filter(n => n.questionId !== questionId));
            deleteQuestion(questionIndex);
        }
    };

    // Handle deleting node from canvas
    const handleDeleteNode = (nodeId, e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (window.confirm('هل أنت متأكد من حذف هذا السؤال من الخريطة؟')) {
            setNodes(prevNodes => prevNodes.filter(n => n.id !== nodeId));
        }
    };

    // Handle adding new question from node
    const handleAddQuestionFromNode = (sourceNodeId, e) => {
        e.preventDefault();
        e.stopPropagation();
        setSourceNodeForAdd(sourceNodeId);
        setShowAddQuestionModal(true);
    };

    // Handle selecting question to add from modal
    const handleSelectQuestionToAdd = (question) => {
        if (!sourceNodeForAdd) return;
        
        const sourceNode = nodes.find(n => n.id === sourceNodeForAdd);
        if (sourceNode) {
            const questionId = question.id || questions.indexOf(question);
            const exists = nodes.some(n => n.questionId === questionId);
            
            if (!exists) {
                const newX = sourceNode.x;
                const newY = sourceNode.y + 200; // Below the source node
                
                handleAddNodeToCanvas(question, newX, newY);
            }
        }
        
        setShowAddQuestionModal(false);
        setSourceNodeForAdd(null);
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
        <div className="workflow-builder">
            {/* Header is handled by Navigation component */}
            
            {/* Main Content */}
            <div className="workflow-content">
                {/* Main Container */}
                <div className="workflow-main-container">
                    {/* Title Section */}
                    <div className="workflow-header-container">
                    <div className="workflow-header-section">
                        <div className="workflow-title-wrapper">
                            <h1 className="workflow-title">Workflow Builder</h1>
                            <p className="workflow-subtitle">Design question flow based on answers (Typeform-style)</p>
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="workflow-actions">
                            <button 
                                className="workflow-btn workflow-btn-secondary"
                                onClick={handleBackToDesigner}
                            >
                                Back to Designer
                            </button>
                            <button 
                                className="workflow-btn workflow-btn-secondary"
                                onClick={handleResetLayout}
                            >
                                Reset Layout
                            </button>
                            <button 
                                className="workflow-btn workflow-btn-primary"
                                onClick={handleSave}
                            >
                                {saved ? 'Saved!' : 'Save'}
                            </button>
                            </div>
                        </div>
                    </div>

                    {/* Main Builder Area */}
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
                        onWheel={handleCanvasWheel}
                        onDragOver={handleCanvasDragOver}
                        onDrop={handleCanvasDrop}
                        style={{ cursor: isPanning ? 'grabbing' : (!isSelectMode ? 'grab' : 'default') }}
                    >
                        {/* Canvas Toolbar */}
                        <div className="workflow-canvas-toolbar">
                            <button 
                                className={`workflow-toolbar-btn ${isSelectMode ? 'active' : ''}`} 
                                title="Select Tool - Fit to View (Click to see all questions)"
                                onClick={handleSelectModeToggle}
                            >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 2L12.5 7L17.5 8.75L14.5 12.5L15.5 17.5L10 15L4.5 17.5L5.5 12.5L2.5 8.75L7.5 7L10 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                                    <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
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
                                <svg className="workflow-connections" style={{ position: 'absolute', top: 0, left: 0, width: '2000px', height: '2000px', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                                    {/* Draw connections based on node.connections array */}
                                    {nodes.map((node) => {
                                        if (node.connections && node.connections.length > 0) {
                                            return node.connections.map((connectedQuestionId) => {
                                                const connectedNode = nodes.find(n => n.questionId === connectedQuestionId);
                                                if (connectedNode) {
                                                    // Calculate connection points
                                                    // From: bottom center of source node (where the handle is)
                                                    const x1 = node.x + 100; // Center of source node (width is 200px)
                                                    const y1 = node.y + 120; // Bottom of source node (height is 120px)
                                                    
                                                    // To: top center of target node
                                                    const x2 = connectedNode.x + 100; // Center of target node
                                                    const y2 = connectedNode.y; // Top of target node
                                                    
                                                    // Create smooth curved path using bezier curve
                                                    // Calculate control points for smooth curve
                                                    const dx = Math.abs(x2 - x1);
                                                    const dy = Math.abs(y2 - y1);
                                                    const curveOffset = Math.min(dx, dy) * 0.5;
                                                    
                                                    // Control points for smooth bezier curve
                                                    const cp1x = x1;
                                                    const cp1y = y1 + curveOffset;
                                                    const cp2x = x2;
                                                    const cp2y = y2 - curveOffset;
                                                    
                                                    // Create smooth bezier curve path
                                                    const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
                                                    
                                                    return (
                                                        <path
                                                            key={`connection-${node.id}-${connectedNode.id}`}
                                                            d={pathData}
                                                            stroke="rgba(56, 189, 248, 0.6)"
                                                            strokeWidth="3"
                                                            strokeLinecap="round"
                                                            fill="none"
                                                        />
                                                    );
                                                }
                                                return null;
                                            }).filter(Boolean);
                                        }
                                        return null;
                                    }).flat()}
                                    
                                    {/* Draw default connections between sequential nodes if no custom connections exist */}
                                    {nodes.length > 1 && nodes.every(n => !n.connections || n.connections.length === 0) && (
                                        nodes.map((node, index) => {
                                            if (index < nodes.length - 1) {
                                                const nextNode = nodes[index + 1];
                                                const x1 = node.x + 100;
                                                const y1 = node.y + 120;
                                                const x2 = nextNode.x + 100;
                                                const y2 = nextNode.y;
                                                
                                                // Create smooth curved path using bezier curve
                                                const dx = Math.abs(x2 - x1);
                                                const dy = Math.abs(y2 - y1);
                                                const curveOffset = Math.min(dx, dy) * 0.5;
                                                
                                                const cp1x = x1;
                                                const cp1y = y1 + curveOffset;
                                                const cp2x = x2;
                                                const cp2y = y2 - curveOffset;
                                                
                                                const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
                                                
                                                return (
                                                    <path
                                                        key={`default-connection-${node.id}-${nextNode.id}`}
                                                        d={pathData}
                                                        stroke="rgba(56, 189, 248, 0.4)"
                                                        strokeWidth="2"
                                                        strokeDasharray="5,5"
                                                        strokeLinecap="round"
                                                        fill="none"
                                                    />
                                                );
                                            }
                                            return null;
                                        })
                                    )}
                                </svg>
                                
                                {/* Workflow Nodes */}
                                {nodes.map((node) => (
                                    <div
                                        key={node.id}
                                        className={`workflow-node ${dragOverNode?.id === node.id ? 'drag-over' : ''} ${selectedNodes.has(node.id) ? 'selected' : ''} ${draggedNode === node.id ? 'dragging' : ''}`}
                                        style={{
                                            position: 'absolute',
                                            left: `${node.x}px`,
                                            top: `${node.y}px`,
                                            zIndex: draggedNode === node.id ? 10 : (selectedNodes.has(node.id) ? 3 : 2)
                                        }}
                                        onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                                        onClick={(e) => {
                                            // Only handle click if not dragging
                                            if (!isDraggingNode.current) {
                                                handleNodeClick(node.id, e);
                                            }
                                        }}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            handleNodeDoubleClick(node.id, e);
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
                                        {/* Delete button at top */}
                                        <button
                                            className="workflow-node-delete-btn"
                                            onClick={(e) => handleDeleteNode(node.id, e)}
                                            title="حذف السؤال"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                            </svg>
                                        </button>
                                        
                                        <div className="workflow-node-header">
                                            <span className="workflow-node-type">
                                                {(() => {
                                                    // Find the question index based on questionId
                                                    const questionIndex = questions.findIndex((q, idx) => {
                                                        const qId = q.id || idx;
                                                        return qId === node.questionId;
                                                    });
                                                    // If found, use it + 1, otherwise use node index + 1
                                                    return `Q${questionIndex >= 0 ? questionIndex + 1 : nodes.findIndex(n => n.id === node.id) + 1}`;
                                                })()}
                                            </span>
                                        </div>
                                        <div className="workflow-node-content">
                                            <p className="workflow-node-text">{node.text}</p>
                                        </div>
                                        
                                        {/* Add question button at bottom */}
                                        <button
                                            className="workflow-node-add-btn"
                                            onClick={(e) => handleAddQuestionFromNode(node.id, e)}
                                            title="إضافة سؤال جديد"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M10 3V17M3 10H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                            </svg>
                                        </button>
                                        
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

            {/* Add Question Modal */}
            {showAddQuestionModal && (
                <div 
                    className="workflow-branch-modal-overlay"
                    onClick={() => {
                        setShowAddQuestionModal(false);
                        setSourceNodeForAdd(null);
                    }}
                >
                    <div 
                        className="workflow-branch-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="workflow-branch-modal-header">
                            <h2>اختر السؤال للإضافة</h2>
                            <button
                                className="workflow-branch-modal-close"
                                onClick={() => {
                                    setShowAddQuestionModal(false);
                                    setSourceNodeForAdd(null);
                                }}
                            >
                                ×
                            </button>
                        </div>
                        
                        <div className="workflow-add-question-list" style={{ padding: '24px', maxHeight: '400px', overflowY: 'auto' }}>
                            {questions.length === 0 ? (
                                <p style={{ color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' }}>
                                    لا توجد أسئلة متاحة. اذهب إلى Design لإضافة أسئلة.
                                </p>
                            ) : (
                                questions.map((question, index) => {
                                    const questionId = question.id || index;
                                    const isOnCanvas = nodes.some(n => n.questionId === questionId);
                                    
                                    return (
                                        <div
                                            key={questionId}
                                            className={`workflow-add-question-item ${isOnCanvas ? 'disabled' : ''}`}
                                            onClick={() => !isOnCanvas && handleSelectQuestionToAdd(question)}
                                            style={{
                                                padding: '12px',
                                                marginBottom: '8px',
                                                background: isOnCanvas ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.6)',
                                                border: `1px solid ${isOnCanvas ? 'rgba(255, 255, 255, 0.1)' : 'rgba(56, 189, 248, 0.3)'}`,
                                                borderRadius: '8px',
                                                cursor: isOnCanvas ? 'not-allowed' : 'pointer',
                                                opacity: isOnCanvas ? 0.5 : 1,
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontWeight: 600 }}>
                                                {index + 1}. {question.text || question.question || 'Untitled Question'}
                                            </span>
                                            {isOnCanvas && (
                                                <span style={{ color: 'rgba(16, 185, 129, 0.8)', marginLeft: '8px', fontSize: '12px' }}>
                                                    (موجود في الخريطة)
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Branch Editor Modal */}
            {showBranchModal && editingNodeId && (() => {
                const editingNode = nodes.find(n => n.id === editingNodeId);
                if (!editingNode) return null;
                
                return (
                    <div 
                        className="workflow-branch-modal-overlay"
                        onClick={() => {
                            setShowBranchModal(false);
                            setEditingNodeId(null);
                        }}
                    >
                        <div 
                            className="workflow-branch-modal"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="workflow-branch-modal-header">
                                <h2>إعداد الخيارات المتفرعة - {editingNode.text}</h2>
                                <button
                                    className="workflow-branch-modal-close"
                                    onClick={() => {
                                        setShowBranchModal(false);
                                        setEditingNodeId(null);
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                            
                            <BranchEditor
                                node={editingNode}
                                questions={questions}
                                nodes={nodes}
                                onSave={(branches) => handleSaveBranches(editingNodeId, branches)}
                                onCancel={() => {
                                    setShowBranchModal(false);
                                    setEditingNodeId(null);
                                }}
                            />
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

// Branch Editor Component
const BranchEditor = ({ node, questions, nodes, onSave, onCancel }) => {
    const [branches, setBranches] = useState(node.branches || []);
    
    const addBranch = () => {
        setBranches([...branches, { answer: '', nextQuestionId: null }]);
    };
    
    const removeBranch = (index) => {
        setBranches(branches.filter((_, i) => i !== index));
    };
    
    const updateBranch = (index, field, value) => {
        const updated = [...branches];
        updated[index] = { ...updated[index], [field]: value };
        setBranches(updated);
    };
    
    const availableQuestions = questions.filter((q, idx) => {
        const qId = q.id || idx;
        return qId !== node.questionId; // Don't allow connecting to itself
    });
    
    return (
        <div className="workflow-branch-editor">
            <div className="workflow-branch-list">
                {branches.length === 0 ? (
                    <p style={{ color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center', padding: '20px' }}>
                        لا توجد خيارات متفرعة. اضغط "إضافة خيار" لإضافة خيار جديد.
                    </p>
                ) : (
                    branches.map((branch, index) => (
                        <div key={index} className="workflow-branch-item">
                            <div className="workflow-branch-input-group">
                                <label>إذا كان الجواب:</label>
                                <input
                                    type="text"
                                    value={branch.answer}
                                    onChange={(e) => updateBranch(index, 'answer', e.target.value)}
                                    placeholder="مثال: نعم، لا، ممتاز، إلخ..."
                                    className="workflow-branch-input"
                                />
                            </div>
                            <div className="workflow-branch-input-group">
                                <label>ينتقل إلى:</label>
                                <select
                                    value={branch.nextQuestionId !== null ? branch.nextQuestionId : ''}
                                    onChange={(e) => updateBranch(index, 'nextQuestionId', e.target.value ? parseInt(e.target.value) : null)}
                                    className="workflow-branch-select"
                                >
                                    <option value="">-- اختر السؤال --</option>
                                    {availableQuestions.map((q, idx) => {
                                        const qId = q.id || idx;
                                        const questionText = q.text || q.question || `Question ${idx + 1}`;
                                        return (
                                            <option key={qId} value={qId}>
                                                {questionText}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                            <button
                                className="workflow-branch-remove-btn"
                                onClick={() => removeBranch(index)}
                                title="حذف الخيار"
                            >
                                ×
                            </button>
                        </div>
                    ))
                )}
            </div>
            
            <div className="workflow-branch-actions">
                <button
                    className="workflow-branch-add-btn"
                    onClick={addBranch}
                >
                    + إضافة خيار
                </button>
                <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto' }}>
                    <button
                        className="workflow-branch-cancel-btn"
                        onClick={onCancel}
                    >
                        إلغاء
                    </button>
                    <button
                        className="workflow-branch-save-btn"
                        onClick={() => onSave(branches)}
                    >
                        حفظ
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Workflow;


