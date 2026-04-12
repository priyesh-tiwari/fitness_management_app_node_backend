const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const generateInsights = async (userData) => {
  try {
    const { userName, attendanceData, dailyActivities, goalSettings } = userData;

    const prompt = `
You are an expert fitness and wellness coach analyzing ${userName}'s complete health data from the last 30 days.

=== CLASS ATTENDANCE DATA ===
${attendanceData.hasSubscriptions ? `
- Total Classes Attended: ${attendanceData.totalAttended} out of ${attendanceData.totalPossible} possible
- Attendance Rate: ${attendanceData.attendanceRate}%
- Current Streak: ${attendanceData.currentStreak} days
- Longest Streak: ${attendanceData.longestStreak} days

Attendance by Day:
${Object.entries(attendanceData.byDayOfWeek)
  .filter(([_, stats]) => stats.possible > 0)
  .map(([day, stats]) => {
    const rate = Math.round((stats.attended / stats.possible) * 100);
    return `- ${day}: ${stats.attended}/${stats.possible} (${rate}%)`;
  })
  .join('\n')}
` : 'No active program subscriptions yet.'}

=== DAILY HEALTH ACTIVITIES ===
Days Logged: ${dailyActivities.totalDaysLogged} out of 30 possible days

1. Water Intake:
   - Average: ${dailyActivities.avgWaterIntake}ml 
   - Goal: ${goalSettings.waterIntake}ml
   - Success Rate: ${dailyActivities.waterGoalRate}%

2. Exercise:
   - Average: ${dailyActivities.avgExerciseDuration} minutes
   - Goal: ${goalSettings.exerciseDuration} minutes
   - Success Rate: ${dailyActivities.exerciseGoalRate}%

3. Meditation:
   - Average: ${dailyActivities.avgMeditation} minutes
   - Goal: ${goalSettings.meditation} minutes
   - Success Rate: ${dailyActivities.meditationGoalRate}%

4. Sleep:
   - Average: ${dailyActivities.avgSleepTime} hours
   - Goal: ${goalSettings.sleepTime} hours
   - Success Rate: ${dailyActivities.sleepGoalRate}%

Overall: All 4 goals achieved on ${dailyActivities.daysAllGoalsAchieved} out of ${dailyActivities.totalDaysLogged} logged days

=== YOUR TASK ===
Provide personalized wellness insights based on this comprehensive data.

IMPORTANT RULES:
1. Respond ONLY with valid JSON - no extra text, no markdown
2. Keep summary under 60 words - be encouraging and data-driven
3. List 2-4 strengths (what they're doing well)
4. List 2-4 areas for improvement (be constructive)
5. List 3-5 actionable, specific recommendations
6. Consider ALL metrics: attendance, water, exercise, meditation, and sleep
7. Be positive, motivating, and realistic
8. Reference specific numbers from the data

Required JSON format:
{
  "summary": "Brief overview highlighting overall progress and key patterns",
  "strengths": ["specific strength with data", "another strength"],
  "improvements": ["constructive improvement area", "another area"],
  "recommendations": ["specific actionable step 1", "step 2", "step 3"]
}
`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a professional wellness coach providing personalized, holistic health insights covering fitness, hydration, mindfulness, and rest. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 700
    });

    const responseText = completion.choices[0].message.content.trim();

    let insights;
    try {
      const cleanedText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      insights = JSON.parse(cleanedText);

      if (!insights.summary || !insights.strengths ||
          !insights.improvements || !insights.recommendations) {
        throw new Error('Missing required fields');
      }

    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      console.error('AI Response:', responseText);
      insights = generateFallbackInsights(attendanceData, dailyActivities, goalSettings);
    }

    return {
      success: true,
      insights,
      generatedAt: new Date(),
      dataAnalyzed: {
        attendanceRate: attendanceData.attendanceRate,
        currentStreak: attendanceData.currentStreak,
        daysLogged: dailyActivities.totalDaysLogged,
        daysAllGoalsAchieved: dailyActivities.daysAllGoalsAchieved,
        daysAnalyzed: 30
      }
    };

  } catch (error) {
    console.error('AI Service Error:', error.message);
    throw new Error(
      error.message.includes('API key')
        ? 'AI service configuration error. Please contact support.'
        : 'Failed to generate insights. Please try again later.'
    );
  }
};

function generateFallbackInsights(attendanceData, dailyActivities, goalSettings) {
  const strengths = [];
  const improvements = [];
  const recommendations = [];

  if (attendanceData.attendanceRate >= 80) {
    strengths.push(`Excellent ${attendanceData.attendanceRate}% class attendance rate`);
  }
  if (attendanceData.currentStreak >= 3) {
    strengths.push(`Strong ${attendanceData.currentStreak}-day workout streak`);
  }
  if (dailyActivities.waterGoalRate >= 70) {
    strengths.push(`Good hydration habits with ${dailyActivities.waterGoalRate}% goal achievement`);
  }
  if (dailyActivities.sleepGoalRate >= 70) {
    strengths.push(`Consistent sleep schedule with ${dailyActivities.avgSleepTime}hr average`);
  }
  if (dailyActivities.meditationGoalRate >= 70) {
    strengths.push(`Regular mindfulness practice with ${dailyActivities.meditationGoalRate}% consistency`);
  }

  if (dailyActivities.waterGoalRate < 70) {
    improvements.push(`Water intake at ${dailyActivities.avgWaterIntake}ml needs boost to reach ${goalSettings.waterIntake}ml goal`);
    recommendations.push('Set hourly water reminders throughout the day');
  }
  if (dailyActivities.exerciseGoalRate < 70) {
    improvements.push(`Exercise averaging ${dailyActivities.avgExerciseDuration}min, below ${goalSettings.exerciseDuration}min target`);
    recommendations.push('Start with 10-minute sessions and gradually increase duration');
  }
  if (dailyActivities.meditationGoalRate < 70) {
    improvements.push(`Meditation consistency at ${dailyActivities.meditationGoalRate}% could be improved`);
    recommendations.push('Try 5-minute morning meditation to build the habit');
  }
  if (dailyActivities.sleepGoalRate < 70) {
    improvements.push(`Sleep averaging ${dailyActivities.avgSleepTime}hr, aim for ${goalSettings.sleepTime}hr`);
    recommendations.push('Set a consistent bedtime routine 30 minutes before sleep');
  }
  if (attendanceData.attendanceRate < 70 && attendanceData.hasSubscriptions) {
    improvements.push(`Class attendance at ${attendanceData.attendanceRate}% can be more consistent`);
    recommendations.push('Block workout times in your calendar as non-negotiable appointments');
  }
  if (dailyActivities.totalDaysLogged < 20) {
    improvements.push('Daily activity tracking needs to be more consistent');
    recommendations.push('Set an evening reminder to log your daily health activities');
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Keep up your excellent habits and consistency',
      'Set new challenging goals to maintain motivation',
      'Track weekly progress to celebrate small wins'
    );
  }

  if (strengths.length === 0) {
    strengths.push('Starting your wellness journey with data tracking', 'Building awareness of your health habits');
  }
  if (improvements.length === 0) {
    improvements.push('Continue building consistency across all health metrics', 'Focus on sustainable habit formation');
  }

  const completionRate = dailyActivities.totalDaysLogged > 0
    ? Math.round((dailyActivities.daysAllGoalsAchieved / dailyActivities.totalDaysLogged) * 100)
    : 0;

  return {
    summary: `You've logged ${dailyActivities.totalDaysLogged} days with ${completionRate}% complete goal achievement${attendanceData.hasSubscriptions ? ` and ${attendanceData.attendanceRate}% class attendance` : ''}. ${strengths.length > 0 ? 'Great progress on ' + strengths[0].toLowerCase() + '.' : 'Keep building your healthy habits!'}`,
    strengths: strengths.slice(0, 4),
    improvements: improvements.slice(0, 4),
    recommendations: recommendations.slice(0, 5)
  };
}

module.exports = { generateInsights };