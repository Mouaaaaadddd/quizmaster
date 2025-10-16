import { GoogleGenAI, Type } from "@google/genai";
// Fix: Import QuizType as a value because it is used at runtime, while other imports are type-only.
import { QuizType, type Question, type UserAnswers, type CorrectionResponse } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const generateQuiz = async (
  content: string,
  quizType: QuizType,
  numQuestions: number,
  weakTopics?: string
): Promise<Question[]> => {
  
  const quizTypeInstruction = {
    [QuizType.SINGLE]: "Chaque question n'a qu'une seule bonne réponse.",
    [QuizType.MULTIPLE]: "Les questions peuvent avoir plusieurs bonnes réponses.",
    [QuizType.MIXED]: "Un mélange de questions à réponse unique et à réponses multiples."
  }[quizType];

  const topicsInstruction = weakTopics 
    ? `IMPORTANT : Concentrez-vous sur la création de questions liées aux sujets suivants sur lesquels l'utilisateur a eu des difficultés : ${weakTopics}`
    : '';

  const prompt = `
    Vous êtes un expert en conception pédagogique et un professeur d'université spécialisé dans la création de matériel d'évaluation de haute qualité. Votre tâche est de créer un quiz professionnel en français à partir du texte source fourni.

    **Instructions Clés:**
    1.  **Qualité des Questions :** Les questions doivent évaluer une compréhension approfondie du sujet. Allez au-delà de la simple mémorisation. Formulez des questions qui obligent à analyser, comparer, ou appliquer les concepts présentés dans le texte.
    2.  **Autonomie des Questions :** C'est une règle **essentielle**. Les questions doivent être complètement autonomes. Ne faites **jamais** référence au document source. N'utilisez pas d'expressions comme "Selon le texte", "D'après le document", "Dans le passage fourni", etc. Le quiz doit donner l'impression d'être un examen officiel sur le sujet, pas un test de lecture.
    3.  **Nombre de Questions :** Créez exactement ${numQuestions} questions.
    4.  **Type de Quiz :** ${quizType}. ${quizTypeInstruction}
    5.  **Sujets Ciblés (si applicable) :** ${topicsInstruction}
    6.  **Format de Sortie :** Répondez avec un seul objet JSON valide contenant un tableau de questions. N'incluez aucun texte, formatage markdown ou explication en dehors de la structure JSON.
    7.  **Structure de l'Objet :** Chaque objet question dans le tableau doit avoir un ID unique, le texte de la question, les options et le type.

    **Texte Source:**
    ---
    ${content}
    ---
  `;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        questionText: { type: Type.STRING },
        options: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              isCorrect: { type: Type.BOOLEAN }
            },
            required: ['text', 'isCorrect']
          }
        },
        type: { type: Type.STRING, enum: ['single', 'multiple'] }
      },
      required: ['id', 'questionText', 'options', 'type']
    }
  };

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema,
        }
    });

    const jsonText = response.text.trim();
    const parsed = JSON.parse(jsonText);
    
    // Gemini sometimes returns an object with a key, e.g. { "questions": [...] }. Handle this.
    const questionsArray = Array.isArray(parsed) ? parsed : parsed[Object.keys(parsed)[0]];

    if (!Array.isArray(questionsArray)) {
        throw new Error("La réponse de l'API n'est pas un tableau de questions valide.");
    }
    
    // Add a unique ID if Gemini doesn't provide one
    return questionsArray.map((q, index) => ({ ...q, id: q.id || `q-${Date.now()}-${index}` }));

  } catch (error) {
    console.error("Erreur lors de la génération du quiz:", error);
    throw new Error("Impossible de générer le quiz. Veuillez vérifier le contenu fourni et réessayer.");
  }
};

export const correctAndReviewQuiz = async (
    questions: Question[], 
    userAnswers: UserAnswers
): Promise<CorrectionResponse> => {
    
    const quizData = questions.map(q => ({
        questionText: q.questionText,
        options: q.options.map(opt => opt.text),
        correctAnswers: q.options.filter(opt => opt.isCorrect).map(opt => opt.text),
        userAnswer: userAnswers[q.id] || []
    }));

    const prompt = `
    Vous êtes un tuteur expert fournissant des commentaires sur un quiz. Votre tâche est de corriger les réponses de l'utilisateur et de fournir des explications détaillées.

    **Instructions:**
    1.  Examinez les questions du quiz et les réponses de l'utilisateur fournies.
    2.  Pour chaque question, déterminez si la réponse de l'utilisateur est correcte. Une réponse est correcte si elle correspond exactement à toutes les bonnes réponses.
    3.  Pour chaque question, fournissez deux explications : une en **français** et une en **arabe**. L'explication doit clairement indiquer pourquoi la réponse de l'utilisateur était correcte ou incorrecte, et quelle est la bonne réponse et pourquoi.
    4.  Résumez les principaux sujets ou concepts sur lesquels l'utilisateur a commis des erreurs. Ce résumé doit être une chaîne de caractères concise en français.
    5.  Retournez le résultat sous la forme d'un seul objet JSON valide. N'incluez aucun texte, formatage markdown ou explication en dehors de la structure JSON.

    **Données du Quiz:**
    ---
    ${JSON.stringify(quizData, null, 2)}
    ---
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            results: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        questionText: { type: Type.STRING },
                        userAnswer: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correctAnswer: { type: Type.ARRAY, items: { type: Type.STRING } },
                        isCorrect: { type: Type.BOOLEAN },
                        feedbackFR: { type: Type.STRING },
                        feedbackAR: { type: Type.STRING }
                    },
                    required: ['questionText', 'userAnswer', 'correctAnswer', 'isCorrect', 'feedbackFR', 'feedbackAR']
                }
            },
            weakTopics: { type: Type.STRING }
        },
        required: ['results', 'weakTopics']
    };
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro', // Using pro for better reasoning on correction
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema,
            }
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as CorrectionResponse;
    } catch (error) {
        console.error("Erreur lors de la correction du quiz:", error);
        throw new Error("Impossible de corriger le quiz. Une erreur s'est produite.");
    }
};