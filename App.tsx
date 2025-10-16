import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SessionState, QuizType, Question, UserAnswers, CorrectionResponse, DocumentSession } from './types';
import { generateQuiz, correctAndReviewQuiz } from './services/geminiService';
import Loader from './components/Loader';
import { UploadIcon, RefreshIcon, FileIcon, CheckIcon, XCircleIcon, LightbulbIcon, TrashIcon, ChevronLeftIcon } from './components/icons';

const APP_STORAGE_KEY = 'quizmaster_ai_sessions';

const App: React.FC = () => {
    const [sessions, setSessions] = useState<Record<string, DocumentSession>>({});
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load sessions from localStorage on initial mount
    useEffect(() => {
        try {
            const savedSessions = localStorage.getItem(APP_STORAGE_KEY);
            if (savedSessions) {
                setSessions(JSON.parse(savedSessions));
            }
        } catch (error) {
            console.error("Failed to load sessions from localStorage", error);
        }
        setIsLoaded(true);
    }, []);

    // Save sessions to localStorage whenever they change
    useEffect(() => {
        if (!isLoaded) return;
        try {
            localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(sessions));
        } catch (error) {
            console.error("Failed to save sessions to localStorage", error);
        }
    }, [sessions, isLoaded]);

    const activeSession = activeSessionId ? sessions[activeSessionId] : null;

    const updateActiveSession = (updates: Partial<Omit<DocumentSession, 'id'>>) => {
        if (!activeSessionId) return;
        setSessions(prev => ({
            ...prev,
            [activeSessionId]: {
                ...prev[activeSessionId],
                ...updates,
                lastAccessed: Date.now(),
            }
        }));
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const text = await file.text();
                const newId = `session-${Date.now()}`;
                const newSession: DocumentSession = {
                    id: newId,
                    fileName: file.name,
                    content: text,
                    quizType: QuizType.MIXED,
                    numQuestions: 5,
                    questions: [],
                    userAnswers: {},
                    correction: null,
                    weakTopics: undefined,
                    lastAccessed: Date.now(),
                    state: SessionState.CONFIGURING_QUIZ,
                };
                setSessions(prev => ({ ...prev, [newId]: newSession }));
                setActiveSessionId(newId);
            } catch (err) {
                // This error state is transient and doesn't need to be saved
                alert('Impossible de lire le fichier.');
            }
        }
    };

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Êtes-vous sûr de vouloir supprimer cette session ? Cette action est irréversible.")) {
            setSessions(prev => {
                const newSessions = { ...prev };
                delete newSessions[sessionId];
                return newSessions;
            });
            if (activeSessionId === sessionId) {
                setActiveSessionId(null);
            }
        }
    };

    const handleGenerateQuiz = useCallback(async () => {
        if (!activeSession) return;
        updateActiveSession({ state: SessionState.GENERATING_QUIZ, error: null });
        try {
            const generatedQuestions = await generateQuiz(activeSession.content, activeSession.quizType, activeSession.numQuestions, activeSession.weakTopics);
            if (generatedQuestions.length === 0) {
              throw new Error("L'API n'a retourné aucune question. Veuillez vérifier le contenu fourni.");
            }
            updateActiveSession({
                questions: generatedQuestions,
                userAnswers: {},
                correction: null,
                state: SessionState.TAKING_QUIZ,
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Une erreur inconnue est survenue.';
            updateActiveSession({ error: errorMessage, state: SessionState.ERROR });
        }
    }, [activeSession]);

    const handleAnswerChange = (questionId: string, optionText: string, isMultiple: boolean) => {
        if (!activeSession) return;
        const currentAnswers = activeSession.userAnswers[questionId] || [];
        let newAnswers: string[];
        if (isMultiple) {
            if (currentAnswers.includes(optionText)) {
                newAnswers = currentAnswers.filter(a => a !== optionText);
            } else {
                newAnswers = [...currentAnswers, optionText];
            }
        } else {
            newAnswers = [optionText];
        }
        updateActiveSession({
            userAnswers: { ...activeSession.userAnswers, [questionId]: newAnswers }
        });
    };
    
    const isQuizAnswered = useMemo(() => {
        if (!activeSession || activeSession.questions.length === 0) return false;
        return activeSession.questions.every(q => activeSession.userAnswers[q.id] && activeSession.userAnswers[q.id].length > 0);
    }, [activeSession]);

    const handleSubmitQuiz = useCallback(async () => {
        if (!isQuizAnswered || !activeSession) return;
        updateActiveSession({ state: SessionState.SUBMITTING_QUIZ, error: null });
        try {
            const result = await correctAndReviewQuiz(activeSession.questions, activeSession.userAnswers);
            updateActiveSession({
                correction: result,
                weakTopics: result.weakTopics,
                state: SessionState.REVIEWING_QUIZ,
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Une erreur inconnue est survenue.';
            updateActiveSession({ error: errorMessage, state: SessionState.ERROR });
        }
    }, [activeSession, isQuizAnswered]);

    const resetSession = (isNewFile: boolean = false) => {
        if (!activeSessionId) return;
        if (isNewFile) {
            handleDeleteSession(activeSessionId);
            setActiveSessionId(null);
        } else {
            updateActiveSession({
                state: SessionState.CONFIGURING_QUIZ,
                questions: [],
                userAnswers: {},
                correction: null,
                error: null,
                weakTopics: undefined,
            });
        }
    };
    
    const renderDocumentSelection = () => {
        const sortedSessions = Object.values(sessions).sort((a, b) => b.lastAccessed - a.lastAccessed);
        return (
            <div className="w-full max-w-3xl mx-auto">
                <div className="bg-white p-8 rounded-xl shadow-lg text-center">
                    <h2 className="text-2xl font-bold text-slate-800 mb-4">Mes Documents</h2>
                    <p className="text-slate-600 mb-6">Sélectionnez un document pour continuer ou téléchargez-en un nouveau.</p>
                    <label htmlFor="file-upload" className="cursor-pointer w-full flex justify-center items-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold">
                        <UploadIcon className="w-6 h-6 mr-2" />
                        Télécharger un Nouveau Fichier
                    </label>
                    <input id="file-upload" type="file" className="hidden" accept=".txt,.md,.pdf" onChange={handleFileChange} />
                </div>
                {sortedSessions.length > 0 && (
                     <div className="mt-8 space-y-4">
                        {sortedSessions.map(session => (
                            <div key={session.id} className="bg-white p-4 rounded-lg shadow-md flex items-center justify-between hover:shadow-xl transition-shadow">
                                <div className="flex items-center truncate cursor-pointer" onClick={() => setActiveSessionId(session.id)}>
                                    <FileIcon className="w-8 h-8 mr-4 text-slate-400 flex-shrink-0" />
                                    <div className="truncate">
                                        <p className="font-semibold text-slate-800 truncate">{session.fileName}</p>
                                        <p className="text-sm text-slate-500">
                                            Dernier accès : {new Date(session.lastAccessed).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSession(session.id);
                                    }}
                                    className="p-2 text-slate-500 hover:bg-red-100 hover:text-red-600 rounded-full transition-colors"
                                    aria-label="Supprimer la session"
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderQuizConfig = () => (
        <div className="w-full max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Configurer le Quiz</h2>
                 <button onClick={() => resetSession(true)} className="text-sm text-slate-600 hover:text-blue-600 font-medium">Changer de fichier</button>
            </div>

            <div className="flex items-center bg-slate-100 p-3 rounded-lg mb-6">
                <FileIcon className="w-6 h-6 mr-3 text-slate-500" />
                <span className="font-medium text-slate-700 truncate">{activeSession?.fileName}</span>
            </div>
            
            {activeSession?.weakTopics && (
                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded-md" role="alert">
                  <p className="font-bold">Mode Amélioration</p>
                  <p>Le quiz se concentrera sur vos points faibles : {activeSession.weakTopics}</p>
                </div>
            )}

            <div className="mb-4">
                <label htmlFor="numQuestions" className="block text-slate-700 font-semibold mb-2">Nombre de questions :</label>
                <input
                    type="number"
                    id="numQuestions"
                    value={activeSession?.numQuestions}
                    onChange={(e) => updateActiveSession({ numQuestions: Math.max(1, parseInt(e.target.value, 10))})}
                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="1"
                    max="20"
                />
            </div>

            <div className="mb-6">
                <label className="block text-slate-700 font-semibold mb-2">Type de quiz :</label>
                <div className="flex space-x-4">
                    {Object.values(QuizType).map(type => (
                        <button
                            key={type}
                            onClick={() => updateActiveSession({ quizType: type })}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${activeSession?.quizType === type ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>
            
            <button
                onClick={handleGenerateQuiz}
                disabled={!activeSession?.content}
                className="w-full py-3 px-4 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
                {activeSession?.weakTopics ? 'Générer un nouveau quiz ciblé' : 'Générer le Quiz'}
            </button>
        </div>
    );
    
    const renderQuiz = () => (
        <div className="w-full max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-lg">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-4">{activeSession?.fileName}</h2>
            {activeSession?.questions.map((q, qIndex) => (
                <div key={q.id} className="mb-8">
                    <p className="font-semibold text-slate-700 mb-4">{qIndex + 1}. {q.questionText}</p>
                    <div className="space-y-3">
                        {q.options.map((option, oIndex) => {
                            const isSelected = activeSession?.userAnswers[q.id]?.includes(option.text);
                            return (
                                <label key={oIndex} className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${isSelected ? 'bg-blue-100 border-blue-500' : 'border-slate-300 hover:border-blue-400'}`}>
                                    <input
                                        type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                                        name={q.id}
                                        checked={isSelected || false}
                                        onChange={() => handleAnswerChange(q.id, option.text, q.type === 'multiple')}
                                        className="form-radio h-5 w-5 text-blue-600 mr-3"
                                    />
                                    <span>{option.text}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            ))}
            <button
                onClick={handleSubmitQuiz}
                disabled={!isQuizAnswered}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
                Soumettre le Quiz
            </button>
        </div>
    );

    const renderReview = () => {
        if (!activeSession?.correction) return null;
        const { correction } = activeSession;
        const score = correction.results.filter(r => r.isCorrect).length;
        const total = correction.results.length;
        const scorePercentage = Math.round((score / total) * 100);

        return (
            <div className="w-full max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg">
                <h2 className="text-3xl font-bold text-slate-800 mb-2 text-center">Résultats du Quiz</h2>
                <div className={`text-4xl font-extrabold text-center mb-4 ${scorePercentage >= 70 ? 'text-green-500' : scorePercentage >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
                    {score} / {total} ({scorePercentage}%)
                </div>
                
                {correction.weakTopics && (
                    <div className="bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 my-6 rounded-md" role="alert">
                      <div className="flex items-center">
                        <LightbulbIcon className="w-6 h-6 mr-3"/>
                        <div>
                          <p className="font-bold">Points à améliorer</p>
                          <p>{correction.weakTopics}</p>
                        </div>
                      </div>
                    </div>
                )}

                <div className="space-y-6 mt-8">
                    {correction.results.map((result, index) => (
                        <div key={index} className={`p-4 rounded-lg border-l-4 ${result.isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
                            <div className="flex items-start">
                                {result.isCorrect 
                                    ? <CheckIcon className="w-6 h-6 text-green-600 mr-3 flex-shrink-0 mt-1" /> 
                                    : <XCircleIcon className="w-6 h-6 text-red-600 mr-3 flex-shrink-0 mt-1" />
                                }
                                <div>
                                    <p className="font-bold text-slate-800">{result.questionText}</p>
                                    <p className="text-sm text-slate-600 mt-2">Votre réponse : <span className="font-medium text-slate-800">{result.userAnswer.join(', ') || 'N/A'}</span></p>
                                    {!result.isCorrect && <p className="text-sm text-slate-600">Réponse correcte : <span className="font-medium text-green-700">{result.correctAnswer.join(', ')}</span></p>}
                                    <details className="mt-3 group">
                                      <summary className="text-sm font-medium text-blue-600 cursor-pointer hover:underline">
                                        Voir l'explication
                                      </summary>
                                      <div className="mt-2 p-3 bg-white rounded-md border border-slate-200">
                                        <p className="text-sm text-slate-700"><strong>FR:</strong> {result.feedbackFR}</p>
                                        <p className="text-sm text-slate-700 mt-2" dir="rtl"><strong>AR:</strong> {result.feedbackAR}</p>
                                      </div>
                                    </details>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
                    <button
                        onClick={() => resetSession(true)}
                        className="w-full sm:w-auto py-3 px-6 bg-slate-600 text-white rounded-lg font-bold hover:bg-slate-700 transition flex items-center justify-center gap-2"
                    >
                        <RefreshIcon className="w-5 h-5" />
                        Nouveau Quiz
                    </button>
                    {correction.weakTopics && (
                         <button
                            onClick={() => updateActiveSession({ state: SessionState.CONFIGURING_QUIZ, questions: [], userAnswers: {}, correction: null, error: null })}
                            className="w-full sm:w-auto py-3 px-6 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2"
                        >
                            <LightbulbIcon className="w-5 h-5" />
                           Améliorer mes points faibles
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderError = () => (
        <div className="w-full max-w-xl mx-auto bg-white p-8 rounded-xl shadow-lg text-center">
            <XCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Une erreur est survenue</h2>
            <p className="text-slate-600 bg-red-50 p-3 rounded-md">{activeSession?.error}</p>
            <button
                onClick={() => updateActiveSession({ state: SessionState.CONFIGURING_QUIZ, error: null })}
                className="mt-6 py-2 px-6 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition"
            >
                Recommencer
            </button>
        </div>
    );
    
    const renderActiveSession = () => {
        if (!activeSession) return null;
        switch (activeSession.state) {
            case SessionState.CONFIGURING_QUIZ: return renderQuizConfig();
            case SessionState.GENERATING_QUIZ: return <Loader text="Génération du quiz en cours..." />;
            case SessionState.TAKING_QUIZ: return renderQuiz();
            case SessionState.SUBMITTING_QUIZ: return <Loader text="Correction de vos réponses..." />;
            case SessionState.REVIEWING_QUIZ: return renderReview();
            case SessionState.ERROR: return renderError();
            default: return null;
        }
    };

    return (
        <div className="bg-slate-100 min-h-screen font-sans flex flex-col items-center p-4 sm:p-6">
             <header className="w-full max-w-5xl mx-auto mb-6 flex items-center">
                {activeSessionId && (
                    <button 
                        onClick={() => setActiveSessionId(null)} 
                        className="mr-4 p-2 text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
                        aria-label="Retour à la sélection des documents"
                    >
                        <ChevronLeftIcon className="w-6 h-6" />
                    </button>
                )}
                <div className={`text-center ${activeSessionId ? 'text-left' : 'w-full'}`}>
                    <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">
                        QuizMaster AI
                    </h1>
                    <p className="text-slate-600 mt-2">Transformez n'importe quel texte en quiz interactif avec l'IA.</p>
                </div>
            </header>
            <main className="w-full flex-grow flex items-center justify-center">
                {!isLoaded 
                    ? <Loader text="Chargement de vos sessions..." /> 
                    : activeSessionId ? renderActiveSession() : renderDocumentSelection()
                }
            </main>
        </div>
    );
};

export default App;
