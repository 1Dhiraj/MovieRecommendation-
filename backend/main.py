from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from textblob import TextBlob
import re
import uvicorn
import requests
import os
from urllib.parse import quote

app = FastAPI(title="Movie Recommendation API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load .env file manually
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                key, val = line.strip().split("=", 1)
                os.environ[key.strip()] = val.strip()

# OMDB API Configuration
OMDB_API_KEY = os.getenv("OMDB_API_KEY", "40f84d34")  # Replace with your actual API key
OMDB_BASE_URL = "http://www.omdbapi.com/"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Pydantic models
class ChatMessage(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []

class ChatResponse(BaseModel):
    reply: str

class Movie(BaseModel):
    id: int
    title: str
    director: str
    actors: List[str]
    genres: List[str]
    description: str
    image_url: str
    rating: float

class MovieRecommendation(BaseModel):
    movie: Movie
    similarity_score: float
    reason: str

class ReviewRequest(BaseModel):
    movie_id: int
    review_text: str

class SentimentResponse(BaseModel):
    sentiment: str
    polarity: float
    subjectivity: float

# Global variables for ML models and data
movies_df = None
tfidf_matrix = None
cosine_sim = None
sentiment_model = None
poster_cache = {}  # Cache for OMDB API responses

def get_movie_poster_from_omdb(title: str, year: str = None) -> str:
    """Fetch movie poster from OMDB API"""
    global poster_cache
    
    # Create cache key
    cache_key = f"{title}_{year}" if year else title
    
    # Check cache first
    if cache_key in poster_cache:
        return poster_cache[cache_key]
    
    try:
        # Clean the title for API request
        clean_title = title.strip().replace('Â', '').replace('\xa0', ' ')
        
        # Prepare API parameters
        params = {
            'apikey': OMDB_API_KEY,
            't': clean_title,
            'type': 'movie'
        }
        
        # Add year if available
        if year:
            params['y'] = year
        
        # Make API request
        response = requests.get(OMDB_BASE_URL, params=params, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('Response') == 'True' and data.get('Poster') != 'N/A':
                poster_url = data['Poster']
                # Cache the result
                poster_cache[cache_key] = poster_url
                return poster_url
            else:
                # Try without year if initial search failed
                if year:
                    params_no_year = {
                        'apikey': OMDB_API_KEY,
                        't': clean_title,
                        'type': 'movie'
                    }
                    response_no_year = requests.get(OMDB_BASE_URL, params=params_no_year, timeout=5)
                    
                    if response_no_year.status_code == 200:
                        data_no_year = response_no_year.json()
                        if data_no_year.get('Response') == 'True' and data_no_year.get('Poster') != 'N/A':
                            poster_url = data_no_year['Poster']
                            poster_cache[cache_key] = poster_url
                            return poster_url
        
    except Exception as e:
        print(f"Error fetching poster for '{title}': {e}")
    
    # Fallback to placeholder
    fallback_url = f"https://placehold.co/300x450/1a1a1a/ffffff?text={quote(title.replace(' ', '+'))}"
    poster_cache[cache_key] = fallback_url
    return fallback_url

def get_movie_poster_url(title: str, year: str = None) -> str:
    """Get movie poster URL with OMDB API integration"""
    if OMDB_API_KEY and OMDB_API_KEY != "YOUR_OMDB_API_KEY_HERE":
        return get_movie_poster_from_omdb(title, year)
    else:
        # Fallback to placeholder if no API key
        return f"https://placehold.co/300x450/1a1a1a/ffffff?text={quote(title.replace(' ', '+'))}"

def extract_year_from_title(title: str) -> tuple:
    """Extract year from movie title if present"""
    import re
    
    # Pattern to match year in parentheses at the end
    year_pattern = r'\((\d{4})\)$'
    match = re.search(year_pattern, title.strip())
    
    if match:
        year = match.group(1)
        clean_title = re.sub(year_pattern, '', title).strip()
        return clean_title, year
    
    return title.strip(), None

def load_and_preprocess_data():
    """Load and preprocess movie data and reviews"""
    global movies_df, tfidf_matrix, cosine_sim, sentiment_model

    try:
        # Try to load dataset
        movies_df = pd.read_csv('dataset.csv')
        print(f"Loaded {len(movies_df)} movies from dataset.csv")

    except FileNotFoundError:
        print("dataset.csv not found. Creating sample dataset...")
        # Create sample dataset if file not found
        sample_data = {
            'movie_title': [
                'Avatar (2009)', 'The Dark Knight (2008)', 'Inception (2010)', 'Interstellar (2014)', 
                'The Matrix (1999)', 'Pulp Fiction (1994)', 'The Godfather (1972)', 'Goodfellas (1990)',
                'Forrest Gump (1994)', 'The Shawshank Redemption (1994)', 'Titanic (1997)', 
                'Jurassic Park (1993)', 'Star Wars (1977)', 'The Lion King (1994)', 'Finding Nemo (2003)',
                'Toy Story (1995)', 'The Avengers (2012)', 'Iron Man (2008)', 'Spider-Man (2002)',
                'Batman Begins (2005)', 'Gladiator (2000)', 'Saving Private Ryan (1998)', 'Braveheart (1995)',
                'The Lord of the Rings (2001)', 'Pirates of the Caribbean (2003)', 'Transformers (2007)',
                'Mission: Impossible (1996)', 'Top Gun (1986)', 'Rocky (1976)', 'Die Hard (1988)',
                'Terminator 2 (1991)', 'Aliens (1986)', 'Predator (1987)', 'Rambo (1982)', 'Speed (1994)',
                'The Fast and the Furious (2001)', 'John Wick (2014)', 'Mad Max: Fury Road (2015)',
                'Casino Royale (2006)', 'Skyfall (2012)', 'Mission: Impossible (1996)', 'Heat (1995)',
                'Scarface (1983)', 'The Departed (2006)', 'Casino (1995)', 'Ocean\'s Eleven (2001)',
                'The Italian Job (2003)', 'Gone in 60 Seconds (2000)', 'Rush Hour (1998)', 'Lethal Weapon (1987)'
            ],
            'director_name': [
                'James Cameron', 'Christopher Nolan', 'Christopher Nolan', 'Christopher Nolan',
                'Lana Wachowski', 'Quentin Tarantino', 'Francis Ford Coppola', 'Martin Scorsese',
                'Robert Zemeckis', 'Frank Darabont', 'James Cameron', 'Steven Spielberg', 'George Lucas',
                'Roger Allers', 'Andrew Stanton', 'John Lasseter', 'Joss Whedon', 'Jon Favreau',
                'Sam Raimi', 'Christopher Nolan', 'Ridley Scott', 'Steven Spielberg', 'Mel Gibson',
                'Peter Jackson', 'Gore Verbinski', 'Michael Bay', 'Brian De Palma', 'Tony Scott',
                'John G. Avildsen', 'John McTiernan', 'James Cameron', 'James Cameron', 'John McTiernan',
                'Ted Kotcheff', 'Jan de Bont', 'Rob Cohen', 'Chad Stahelski', 'George Miller',
                'Martin Campbell', 'Sam Mendes', 'Brian De Palma', 'Michael Mann', 'Brian De Palma',
                'Martin Scorsese', 'Martin Scorsese', 'Steven Soderbergh', 'F. Gary Gray', 'Dominic Sena',
                'Brett Ratner', 'Richard Donner'
            ],
            'actor_1_name': [
                'Sam Worthington', 'Christian Bale', 'Leonardo DiCaprio', 'Matthew McConaughey',
                'Keanu Reeves', 'John Travolta', 'Marlon Brando', 'Robert De Niro', 'Tom Hanks',
                'Tim Robbins', 'Leonardo DiCaprio', 'Sam Neill', 'Mark Hamill', 'Matthew Broderick',
                'Albert Brooks', 'Tom Hanks', 'Robert Downey Jr.', 'Robert Downey Jr.', 'Tobey Maguire',
                'Christian Bale', 'Russell Crowe', 'Tom Hanks', 'Mel Gibson', 'Elijah Wood',
                'Johnny Depp', 'Shia LaBeouf', 'Tom Cruise', 'Tom Cruise', 'Sylvester Stallone',
                'Bruce Willis', 'Arnold Schwarzenegger', 'Sigourney Weaver', 'Arnold Schwarzenegger',
                'Sylvester Stallone', 'Keanu Reeves', 'Paul Walker', 'Keanu Reeves', 'Tom Hardy',
                'Daniel Craig', 'Daniel Craig', 'Tom Cruise', 'Al Pacino', 'Al Pacino',
                'Leonardo DiCaprio', 'Robert De Niro', 'George Clooney', 'Mark Wahlberg', 'Nicolas Cage',
                'Jackie Chan', 'Mel Gibson'
            ],
            'actor_2_name': [
                'Zoe Saldana', 'Heath Ledger', 'Marion Cotillard', 'Anne Hathaway', 'Laurence Fishburne',
                'Uma Thurman', 'Al Pacino', 'Ray Liotta', 'Robin Wright', 'Morgan Freeman',
                'Kate Winslet', 'Laura Dern', 'Harrison Ford', 'Jeremy Irons', 'Ellen DeGeneres',
                'Tim Allen', 'Chris Evans', 'Gwyneth Paltrow', 'Kirsten Dunst', 'Michael Caine',
                'Joaquin Phoenix', 'Matt Damon', 'Sophie Marceau', 'Ian McKellen', 'Orlando Bloom',
                'Megan Fox', 'Jon Voight', 'Kelly McGillis', 'Talia Shire', 'Alan Rickman',
                'Linda Hamilton', 'Michael Biehn', 'Carl Weathers', 'Richard Crenna', 'Sandra Bullock',
                'Vin Diesel', 'Ian McShane', 'Charlize Theron', 'Eva Green', 'Judi Dench',
                'Jon Voight', 'Robert De Niro', 'Michelle Pfeiffer', 'Matt Damon', 'Sharon Stone',
                'Brad Pitt', 'Charlize Theron', 'Angelina Jolie', 'Chris Tucker', 'Danny Glover'
            ],
            'actor_3_name': [
                'Sigourney Weaver', 'Aaron Eckhart', 'Tom Hardy', 'Jessica Chastain', 'Carrie-Anne Moss',
                'Samuel L. Jackson', 'James Caan', 'Joe Pesci', 'Gary Sinise', 'James Whitmore',
                'Billy Zane', 'Jeff Goldblum', 'Carrie Fisher', 'James Earl Jones', 'Alexander Gould',
                'Don Rickles', 'Scarlett Johansson', 'Terrence Howard', 'James Franco', 'Gary Oldman',
                'Connie Nielsen', 'Tom Sizemore', 'Catherine McCormack', 'Viggo Mortensen', 'Keira Knightley',
                'Josh Duhamel', 'Ving Rhames', 'Anthony Edwards', 'Burt Young', 'Bonnie Bedelia',
                'Edward Furlong', 'Bill Paxton', 'Jesse Ventura', 'Brian Dennehy', 'Dennis Hopper',
                'Michelle Rodriguez', 'Alfie Allen', 'Nicholas Hoult', 'Mads Mikkelsen', 'Ralph Fiennes',
                'Ving Rhames', 'Val Kilmer', 'Steven Bauer', 'Jack Nicholson', 'James Woods',
                'Matt Damon', 'Jason Statham', 'Robert Duvall', 'Elizabeth Pena', 'Joe Pesci'
            ],
            'genres': [
                'Action Adventure Fantasy Sci-Fi', 'Action Crime Drama', 'Action Sci-Fi Thriller', 'Adventure Drama Sci-Fi',
                'Action Sci-Fi', 'Crime Drama', 'Crime Drama', 'Biography Crime Drama', 'Drama Romance',
                'Drama', 'Drama Romance', 'Adventure Sci-Fi Thriller', 'Adventure Fantasy Sci-Fi', 'Adventure Animation Family',
                'Adventure Animation Family', 'Adventure Animation Family Comedy', 'Action Adventure Sci-Fi', 'Action Adventure Sci-Fi',
                'Action Adventure Sci-Fi', 'Action Crime Drama', 'Action Drama History', 'Action Drama War', 'Biography Drama History War',
                'Adventure Drama Fantasy', 'Action Adventure Fantasy', 'Action Adventure Sci-Fi', 'Action Adventure Thriller',
                'Action Drama', 'Drama Sport', 'Action Thriller', 'Action Sci-Fi Thriller', 'Action Horror Sci-Fi',
                'Action Horror Sci-Fi', 'Action Adventure Thriller', 'Action Thriller', 'Action Adventure Romance Thriller',
                'Action Adventure Thriller', 'Action Crime Thriller', 'Action Adventure Sci-Fi Thriller', 'Action Adventure Thriller',
                'Action Adventure Thriller', 'Action Adventure Thriller', 'Crime Drama Thriller', 'Biography Crime Drama',
                'Crime Drama Thriller', 'Crime Drama', 'Comedy Crime Thriller', 'Action Crime Thriller', 'Action Crime Thriller',
                'Action Comedy Crime', 'Action Comedy Crime'
            ]
        }
        
        movies_df = pd.DataFrame(sample_data)
        print(f"Created sample dataset with {len(movies_df)} movies")
    
    # Clean and preprocess data
    movies_df['director_name'] = movies_df['director_name'].fillna('')
    movies_df['actor_1_name'] = movies_df['actor_1_name'].fillna('')
    movies_df['actor_2_name'] = movies_df['actor_2_name'].fillna('')
    movies_df['actor_3_name'] = movies_df['actor_3_name'].fillna('')
    movies_df['genres'] = movies_df['genres'].fillna('')
    movies_df['movie_title'] = movies_df['movie_title'].fillna('')
    
    # Create combined features for content-based filtering
    movies_df['combined_features'] = (
        movies_df['director_name'] + ' ' +
        movies_df['actor_1_name'] + ' ' +
        movies_df['actor_2_name'] + ' ' +
        movies_df['actor_3_name'] + ' ' +
        movies_df['genres']
    )
    
    # Create TF-IDF matrix
    tfidf = TfidfVectorizer(stop_words='english', lowercase=True)
    tfidf_matrix = tfidf.fit_transform(movies_df['combined_features'])
    
    # Calculate cosine similarity matrix
    cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)
    print("Content-based recommendation system initialized")
    
    # Load and preprocess reviews for sentiment analysis
    try:
        reviews_df = pd.read_csv('reviews.txt', sep='\t', header=None, names=['sentiment', 'review'])

        # Clean all review text consistently
        reviews_df['review'] = reviews_df['review'].apply(clean_text)

        # Train sentiment analysis model
        X = reviews_df['review'].values
        y = reviews_df['sentiment'].values

        # Create TF-IDF features for sentiment analysis
        tfidf_sentiment = TfidfVectorizer(max_features=5000, stop_words='english')
        X_tfidf = tfidf_sentiment.fit_transform(X)

        # Train Random Forest classifier
        X_train, X_test, y_train, y_test = train_test_split(X_tfidf, y, test_size=0.2, random_state=42)
        sentiment_model = {
            'classifier': RandomForestClassifier(n_estimators=100, random_state=42),
            'vectorizer': tfidf_sentiment
        }
        sentiment_model['classifier'].fit(X_train, y_train)
        print("Sentiment analysis model trained")

    except Exception as e:
        print(f"Warning: Could not load reviews data: {e}")
        sentiment_model = None

def clean_text(text: str) -> str:
    """Clean text for sentiment analysis"""
    text = re.sub(r'[^a-zA-Z\s]', '', text)
    text = text.lower().strip()
    return text

def analyze_sentiment_textblob(text: str) -> dict:
    """Analyze sentiment using TextBlob"""
    blob = TextBlob(text)
    polarity = blob.sentiment.polarity
    subjectivity = blob.sentiment.subjectivity
    
    if polarity > 0.1:
        sentiment = "positive"
    elif polarity < -0.1:
        sentiment = "negative"
    else:
        sentiment = "neutral"
        
    return {
        "sentiment": sentiment,
        "polarity": polarity,
        "subjectivity": subjectivity
    }

def analyze_sentiment_ml(text: str) -> dict:
    """Analyze sentiment using trained ML model"""
    if sentiment_model is None:
        return analyze_sentiment_textblob(text)
    
    try:
        cleaned_text = clean_text(text)
        text_tfidf = sentiment_model['vectorizer'].transform([cleaned_text])
        prediction = sentiment_model['classifier'].predict(text_tfidf)[0]
        probability = sentiment_model['classifier'].predict_proba(text_tfidf)[0]
        
        return {
            "sentiment": "positive" if prediction == 1 else "negative",
            "polarity": max(probability) if prediction == 1 else -max(probability),
            "subjectivity": 0.5  # Default value for ML model
        }
    except Exception as e:
        print(f"Error in ML sentiment analysis: {e}")
        return analyze_sentiment_textblob(text)

def create_movie_object(idx: int, row) -> Movie:
    """Create a Movie object from DataFrame row"""
    actors = [actor.strip() for actor in [row['actor_1_name'], row['actor_2_name'], row['actor_3_name']] if actor and actor.strip()]
    genres = [genre.strip() for genre in row['genres'].split() if genre.strip()]
    
    # Extract year from title if present
    clean_title, year = extract_year_from_title(row['movie_title'])
    
    # Create a meaningful description
    description = f"A captivating {' and '.join(genres[:2]).lower()} film directed by {row['director_name']}."
    if actors:
        description += f" Starring {', '.join(actors[:3])}."
    description += " This movie delivers an unforgettable cinematic experience with compelling storytelling and exceptional performances."
    
    return Movie(
        id=idx,
        title=clean_title,
        director=row['director_name'].strip(),
        actors=actors,
        genres=genres,
        description=description,
        image_url=get_movie_poster_url(clean_title, year),
        rating=round(np.random.uniform(6.0, 9.5), 1)
    )

@app.on_event("startup")
async def startup_event():
    """Load data on startup"""
    print(f"Starting Movie Recommendation API...")
    print(f"OMDB API Key configured: {'Yes' if OMDB_API_KEY and OMDB_API_KEY != 'YOUR_OMDB_API_KEY_HERE' else 'No'}")
    load_and_preprocess_data()

@app.get("/")
async def root():
    return {
        "message": "Movie Recommendation API is running!",
        "total_movies": len(movies_df) if movies_df is not None else 0,
        "omdb_configured": OMDB_API_KEY != "YOUR_OMDB_API_KEY_HERE",
        "endpoints": {
            "movies": "/movies",
            "movie_detail": "/movies/{movie_id}",
            "recommendations": "/movies/{movie_id}/recommendations",
            "sentiment": "/sentiment/analyze",
            "search": "/search/movies"
        }
    }

@app.get("/movies", response_model=List[Movie])
async def get_all_movies(limit: int = 50, offset: int = 0):
    """Get all movies with pagination"""
    if movies_df is None:
        raise HTTPException(status_code=500, detail="Movies data not loaded")
    
    # Apply pagination
    end_idx = min(offset + limit, len(movies_df))
    movies_sample = movies_df.iloc[offset:end_idx]
    
    movies = []
    for idx, row in movies_sample.iterrows():
        movie = create_movie_object(idx, row)
        movies.append(movie)
    
    return movies

@app.get("/movies/{movie_id}", response_model=Movie)
async def get_movie(movie_id: int):
    """Get a specific movie by ID"""
    if movies_df is None or movie_id >= len(movies_df):
        raise HTTPException(status_code=404, detail="Movie not found")
    
    row = movies_df.iloc[movie_id]
    return create_movie_object(movie_id, row)

@app.get("/movies/{movie_id}/recommendations", response_model=List[MovieRecommendation])
async def get_movie_recommendations(movie_id: int, limit: int = 5):
    """Get movie recommendations based on content similarity"""
    if movies_df is None or cosine_sim is None:
        raise HTTPException(status_code=500, detail="Recommendation system not initialized")
    
    if movie_id >= len(movies_df):
        raise HTTPException(status_code=404, detail="Movie not found")
    
    # Get similarity scores for the movie
    sim_scores = list(enumerate(cosine_sim[movie_id]))
    
    # Sort movies by similarity score
    sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
    
    # Get top similar movies (excluding the movie itself)
    sim_scores = sim_scores[1:limit+1]
    
    recommendations = []
    original_movie = movies_df.iloc[movie_id]
    
    for idx, score in sim_scores:
        row = movies_df.iloc[idx]
        
        # Create movie object
        movie = create_movie_object(idx, row)
        
        # Determine recommendation reason
        original_genres = set(original_movie['genres'].split())
        current_genres = set(row['genres'].split())
        original_actors = set([original_movie['actor_1_name'], original_movie['actor_2_name'], original_movie['actor_3_name']])
        current_actors = set([row['actor_1_name'], row['actor_2_name'], row['actor_3_name']])
        
        common_genres = original_genres & current_genres
        common_actors = original_actors & current_actors
        
        if row['director_name'] == original_movie['director_name'] and common_genres:
            reason = f"Same director ({row['director_name']}) and similar genres"
        elif common_genres and common_actors:
            reason = f"Similar genres ({', '.join(list(common_genres)[:2])}) and cast"
        elif common_genres:
            reason = f"Similar genres: {', '.join(list(common_genres)[:2])}"
        elif common_actors:
            common_actor_names = [actor for actor in common_actors if actor and actor.strip()]
            if common_actor_names:
                reason = f"Features {common_actor_names[0]}"
            else:
                reason = "Similar cast"
        elif row['director_name'] == original_movie['director_name']:
            reason = f"Same director: {row['director_name']}"
        else:
            reason = "Similar movie characteristics"
        
        recommendation = MovieRecommendation(
            movie=movie,
            similarity_score=round(score, 3),
            reason=reason
        )
        recommendations.append(recommendation)
    
    return recommendations

@app.post("/sentiment/analyze", response_model=SentimentResponse)
async def analyze_sentiment(review: ReviewRequest):
    """Analyze sentiment of a movie review"""
    try:
        # Use ML model if available, otherwise use TextBlob
        sentiment_result = analyze_sentiment_ml(review.review_text)
        
        return SentimentResponse(
            sentiment=sentiment_result["sentiment"],
            polarity=sentiment_result["polarity"],
            subjectivity=sentiment_result["subjectivity"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing sentiment: {str(e)}")

@app.get("/search/movies")
async def search_movies(query: str, limit: int = 10):
    """Search movies by title, director, actor, or genre"""
    if movies_df is None:
        raise HTTPException(status_code=500, detail="Movies data not loaded")
    
    query = query.lower().strip()
    
    # Search in multiple fields
    mask = (
        movies_df['movie_title'].str.lower().str.contains(query, na=False) |
        movies_df['director_name'].str.lower().str.contains(query, na=False) |
        movies_df['actor_1_name'].str.lower().str.contains(query, na=False) |
        movies_df['actor_2_name'].str.lower().str.contains(query, na=False) |
        movies_df['actor_3_name'].str.lower().str.contains(query, na=False) |
        movies_df['genres'].str.lower().str.contains(query, na=False)
    )
    
    search_results = movies_df[mask].head(limit)
    
    movies = []
    for idx, row in search_results.iterrows():
        movie = create_movie_object(idx, row)
        movies.append(movie)
    
    return movies

# New endpoint to get total movie count
@app.get("/movies/count")
async def get_movie_count():
    """Get total number of movies"""
    if movies_df is None:
        return {"total": 0}
    return {"total": len(movies_df)}

# New endpoint to clear poster cache if needed
@app.post("/admin/clear-poster-cache")
async def clear_poster_cache():
    """Clear the poster cache (admin endpoint)"""
    global poster_cache
    cache_size = len(poster_cache)
    poster_cache.clear()
    return {"message": f"Cleared {cache_size} cached poster URLs"}

# Chatbot endpoint using Gemini
@app.post("/chatbot", response_model=ChatResponse)
async def chat_with_gemini(chat_req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    
    # Format the request payload including history
    contents = []
    for turn in chat_req.history:
        contents.append({
            "role": "user" if turn.role == "user" else "model",
            "parts": [{"text": turn.text}]
        })
    
    contents.append({
        "role": "user",
        "parts": [{"text": chat_req.message}]
    })
    
    payload = {
        "systemInstruction": {
            "parts": [{"text": "You are CineBot, a helpful and enthusiastic movie recommendation assistant for the CineRecommend app. Recommend movies and answer movie-related questions. You can refer to movies like Avatar, Inception, The Dark Knight, Interstellar, and Pulp Fiction. Keep responses under 4 sentences, use markdown, and format nicely."}]
        },
        "contents": contents
    }
    
    try:
        response = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if 'candidates' in data and len(data['candidates']) > 0:
                reply = data['candidates'][0]['content']['parts'][0]['text']
                return ChatResponse(reply=reply)
            else:
                raise HTTPException(status_code=500, detail="No response candidates returned from Gemini API")
        else:
            print(f"Gemini API error: {response.status_code} - {response.text}")
            raise HTTPException(status_code=500, detail=f"Gemini API returned error code {response.status_code}")
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        raise HTTPException(status_code=500, detail=f"Internal error calling Gemini: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)