// MET (Metabolic Equivalent of Task) values for different exercises
// MET value represents the energy cost of an activity
// Formula: Calories = MET × Weight(kg) × Duration(hours)

const MET_VALUES = {
  // Cardio exercises
  'running': 10.0,          // ~10 km/h
  'walking': 3.5,           // Moderate pace
  'cycling': 8.0,           // Moderate effort
  'swimming': 8.0,          // Moderate effort
  'jump_rope': 12.3,        // Fast pace
  'hiking': 6.0,            // Cross-country
  'rowing': 7.0,            // Moderate effort
  'elliptical': 5.0,        // Moderate effort
  'stair_climbing': 8.0,    // Vigorous
  
  // Strength training
  'weight_training': 6.0,   // General
  'bodyweight': 5.0,        // Push-ups, pull-ups, etc.
  'powerlifting': 6.0,      // Heavy weights
  
  // Sports
  'basketball': 6.5,        // General play
  'football': 8.0,          // American football
  'soccer': 7.0,            // General play
  'tennis': 7.3,            // Singles
  'badminton': 5.5,         // General play
  'volleyball': 4.0,        // General play
  'cricket': 4.8,           // Batting/fielding
  'boxing': 9.0,            // Sparring
  
  // Fitness classes
  'hiit': 12.0,             // High-intensity interval training
  'zumba': 8.0,             // Dance fitness
  'aerobics': 7.3,          // High impact
  'spinning': 8.5,          // Stationary cycling class
  'crossfit': 10.0,         // Varied intensity
  
  // Mind-body exercises
  'yoga': 3.0,              // Hatha yoga
  'pilates': 4.0,           // General
  'stretching': 2.5,        // Light
  
  // Dance
  'dancing': 7.0,           // General, energetic
  'ballet': 5.0,            // Classical
  
  // Other activities
  'martial_arts': 10.0,     // Judo, karate, etc.
  'rock_climbing': 8.0,     // Indoor/outdoor
  'skateboarding': 5.0,     // General
  'other': 5.0              // Default for unspecified
};

/**
 * Calculate calories burned during exercise
 * @param {string} exerciseType - Type of exercise (must match MET_VALUES keys)
 * @param {number} duration - Duration in minutes
 * @param {number} weight - User's weight in kilograms
 * @returns {number} Calories burned (rounded to nearest integer)
 */
function calculateCalories(exerciseType, duration, weight = 70) {
  // Validate inputs
  if (!exerciseType || !duration || duration <= 0 || weight <= 0) {
    throw new Error('Invalid exercise parameters');
  }

  // Get MET value for the exercise type
  const met = MET_VALUES[exerciseType.toLowerCase()] || MET_VALUES['other'];
  
  // Convert duration from minutes to hours
  const durationInHours = duration / 60;
  
  // Calculate calories: MET × Weight(kg) × Duration(hours)
  const calories = met * weight * durationInHours;
  
  // Return rounded value
  return Math.round(calories);
}

/**
 * Get estimated calorie burn rate per minute
 * @param {string} exerciseType - Type of exercise
 * @param {number} weight - User's weight in kilograms
 * @returns {number} Calories per minute (rounded to 1 decimal)
 */
function getCaloriesPerMinute(exerciseType, weight = 70) {
  const met = MET_VALUES[exerciseType.toLowerCase()] || MET_VALUES['other'];
  const caloriesPerMinute = (met * weight) / 60;
  return Math.round(caloriesPerMinute * 10) / 10;
}

/**
 * Get all available exercise types
 * @returns {Array} Array of exercise type objects with name and MET value
 */
function getExerciseTypes() {
  return Object.entries(MET_VALUES).map(([key, met]) => ({
    key,
    displayName: key.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' '),
    met,
    intensity: getIntensityLevel(met)
  }));
}

/**
 * Get intensity level based on MET value
 * @param {number} met - MET value
 * @returns {string} Intensity level
 */
function getIntensityLevel(met) {
  if (met < 3) return 'Light';
  if (met < 6) return 'Moderate';
  if (met < 9) return 'Vigorous';
  return 'Very Vigorous';
}

/**
 * Calculate duration needed to burn specific calories
 * @param {string} exerciseType - Type of exercise
 * @param {number} targetCalories - Desired calories to burn
 * @param {number} weight - User's weight in kilograms
 * @returns {number} Duration in minutes (rounded up)
 */
function getDurationForCalories(exerciseType, targetCalories, weight = 70) {
  const met = MET_VALUES[exerciseType.toLowerCase()] || MET_VALUES['other'];
  const hoursNeeded = targetCalories / (met * weight);
  const minutesNeeded = hoursNeeded * 60;
  return Math.ceil(minutesNeeded);
}

/**
 * Compare calories burned across different exercises
 * @param {number} duration - Duration in minutes
 * @param {number} weight - User's weight in kilograms
 * @returns {Array} Array of exercises with calories burned, sorted by highest first
 */
function compareExercises(duration, weight = 70) {
  return Object.entries(MET_VALUES)
    .map(([exercise, met]) => ({
      exercise,
      displayName: exercise.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' '),
      calories: calculateCalories(exercise, duration, weight),
      intensity: getIntensityLevel(met)
    }))
    .sort((a, b) => b.calories - a.calories);
}

module.exports = {
  calculateCalories,
  getCaloriesPerMinute,
  getExerciseTypes,
  getDurationForCalories,
  compareExercises,
  MET_VALUES
};