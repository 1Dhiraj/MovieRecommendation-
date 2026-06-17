import React, { useState, useEffect, useRef } from 'react';
import { Search, Star, User, Film, Calendar, Heart, ArrowLeft, Play, Info, ChevronDown, MessageSquare, Send, X, Bot } from 'lucide-react';

const API_BASE_URL = 'http://localhost:8000';
const TMDB_API_KEY = '4e44d9029b1270a757cddc766a1bcb63';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

const App = () => {
  const [movies, setMovies] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [sentiment, setSentiment] = useState(null);
  const [viewMode, setViewMode] = useState('home'); // 'home', 'detail', 'search'
  const [imageCache, setImageCache] = useState({});
  const [totalMovies, setTotalMovies] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMoreMovies, setHasMoreMovies] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [error, setError] = useState(null);

  // Chatbot State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'model', text: "Hi! I'm CineBot. Ask me for movie recommendations or anything about films!" }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, chatOpen]);

  const MOVIES_PER_PAGE = 20;

  useEffect(() => {
    checkApiConnection();
  }, []);

  useEffect(() => {
    if (apiConnected) {
      fetchMovies(0, true);
    }
  }, [apiConnected]);

  const sendChatMessage = async (e) => {
    if (e) e.preventDefault();
    if (!chatMessage.trim() || chatLoading) return;

    const userMessage = chatMessage;
    setChatMessage('');
    
    // Add user message to history
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);
    setChatLoading(true);

    try {
      const formattedHistory = chatHistory.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        text: msg.text
      }));

      const response = await fetch(`${API_BASE_URL}/chatbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: formattedHistory
        })
      });

      if (response.ok) {
        const data = await response.json();
        setChatHistory(prev => [...prev, { role: 'model', text: data.reply }]);
      } else {
        throw new Error('Chatbot response error');
      }
    } catch (error) {
      console.error('Error sending chat message:', error);
      setChatHistory(prev => [...prev, { role: 'model', text: 'Sorry, I am having trouble connecting right now. Please try again later!' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const checkApiConnection = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/`);
      if (response.ok) {
        const data = await response.json();
        setTotalMovies(data.total_movies || 0);
        setApiConnected(true);
        setError(null);
      } else {
        throw new Error('API not responding');
      }
    } catch (error) {
      console.error('API connection failed:', error);
      setApiConnected(false);
      setError('Cannot connect to movie API. Using demo data.');
      // Load demo data as fallback
      loadDemoData();
    }
  };

  const loadDemoData = async () => {
    setLoading(true);
    const demoMovies = await generateDemoMoviesWithPosters();
    setMovies(demoMovies);
    setTotalMovies(demoMovies.length);
    setHasMoreMovies(false);
    setLoading(false);
  };

  // Fetch movie poster from TMDB API
  const fetchMoviePoster = async (title) => {
    if (imageCache[title]) {
      return imageCache[title];
    }

    try {
      const cleanTitle = title.replace(/\s*\(\d{4}\)$/, '').trim();
      const response = await fetch(
        `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`
      );
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const posterPath = data.results[0].poster_path;
        if (posterPath) {
          const posterUrl = `${TMDB_IMAGE_BASE_URL}${posterPath}`;
          setImageCache(prev => ({ ...prev, [title]: posterUrl }));
          return posterUrl;
        }
      }
    } catch (error) {
      console.error('Error fetching movie poster:', error);
    }

    // Fallback to placeholder
    const fallbackUrl = `https://placehold.co/300x450/1a1a1a/ffffff?text=${encodeURIComponent(title)}`;
    setImageCache(prev => ({ ...prev, [title]: fallbackUrl }));
    return fallbackUrl;
  };

  const fetchMovies = async (page = 0, reset = false) => {
    try {
      if (reset) setLoading(true);
      else setLoadingMore(true);

      const offset = page * MOVIES_PER_PAGE;
      const response = await fetch(`${API_BASE_URL}/movies?limit=${MOVIES_PER_PAGE}&offset=${offset}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (reset) {
        setMovies(data);
      } else {
        setMovies(prev => [...prev, ...data]);
      }
      
      setHasMoreMovies(data.length === MOVIES_PER_PAGE);
      setCurrentPage(page);
      setError(null);
      
    } catch (error) {
      console.error('Error fetching movies:', error);
      setError('Failed to load movies from API');
      
      // If this is the first load and API fails, use demo data
      if (reset && movies.length === 0) {
        await loadDemoData();
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreMovies = () => {
    if (!loadingMore && hasMoreMovies && apiConnected) {
      fetchMovies(currentPage + 1, false);
    }
  };

  const generateDemoMoviesWithPosters = async () => {
    const demoMoviesList = [
      {
        id: 0,
        title: "Avatar",
        director: "James Cameron",
        actors: ["Sam Worthington", "Zoe Saldana", "Sigourney Weaver"],
        genres: ["Action", "Adventure", "Fantasy", "Sci-Fi"],
        description: "A paraplegic Marine dispatched to the moon Pandora on a unique mission becomes torn between following his orders and protecting the world he feels is his home.",
        rating: 7.8
      },
      {
        id: 1,
        title: "The Dark Knight",
        director: "Christopher Nolan",
        actors: ["Christian Bale", "Heath Ledger", "Aaron Eckhart"],
        genres: ["Action", "Crime", "Drama"],
        description: "When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests.",
        rating: 9.0
      },
      {
        id: 2,
        title: "Inception",
        director: "Christopher Nolan",
        actors: ["Leonardo DiCaprio", "Marion Cotillard", "Tom Hardy"],
        genres: ["Action", "Sci-Fi", "Thriller"],
        description: "A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.",
        rating: 8.8
      },
      {
        id: 3,
        title: "Interstellar",
        director: "Christopher Nolan",
        actors: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"],
        genres: ["Adventure", "Drama", "Sci-Fi"],
        description: "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
        rating: 8.6
      },
      {
        id: 4,
        title: "The Matrix",
        director: "Lana Wachowski",
        actors: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss"],
        genres: ["Action", "Sci-Fi"],
        description: "A computer programmer is led into a rebellion against machines who have taken over the world and enslaved humanity.",
        rating: 8.7
      },
      {
        id: 5,
        title: "Pulp Fiction",
        director: "Quentin Tarantino",
        actors: ["John Travolta", "Uma Thurman", "Samuel L. Jackson"],
        genres: ["Crime", "Drama"],
        description: "The lives of two mob hitmen, a boxer, a gangster and his wife intertwine in four tales of violence and redemption.",
        rating: 8.9
      },
      {
        id: 6,
        title: "The Godfather",
        director: "Francis Ford Coppola",
        actors: ["Marlon Brando", "Al Pacino", "James Caan"],
        genres: ["Crime", "Drama"],
        description: "The aging patriarch of an organized crime dynasty transfers control of his empire to his reluctant son.",
        rating: 9.2
      },
      {
        id: 7,
        title: "Goodfellas",
        director: "Martin Scorsese",
        actors: ["Robert De Niro", "Ray Liotta", "Joe Pesci"],
        genres: ["Biography", "Crime", "Drama"],
        description: "The story of Henry Hill and his life in the mob, covering twenty-five years in the life of a small-time criminal.",
        rating: 8.7
      }
    ];

    const moviesWithPosters = await Promise.all(
      demoMoviesList.map(async (movie, index) => {
        const posterUrl = await fetchMoviePoster(movie.title);
        return { ...movie, image_url: posterUrl };
      })
    );

    return moviesWithPosters;
  };

  const fetchMovieDetails = async (movieId) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/movies/${movieId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const movie = await response.json();
      // Try to get TMDB poster if the backend image is a placeholder
      if (!movie.image_url || movie.image_url.includes('placeholder') || movie.image_url.includes('via.placeholder') || movie.image_url.includes('placehold.co')) {
        const tmdbUrl = await fetchMoviePoster(movie.title);
        if (tmdbUrl) {
          movie.image_url = tmdbUrl;
        }
      }
      setSelectedMovie(movie);
      
      // Fetch recommendations
      const recResponse = await fetch(`${API_BASE_URL}/movies/${movieId}/recommendations`);
      if (recResponse.ok) {
        const recData = await recResponse.json();
        setRecommendations(recData);
      } else {
        console.error('Failed to fetch recommendations');
        setRecommendations([]);
      }
      
    } catch (error) {
      console.error('Error fetching movie details:', error);
      setError('Failed to load movie details');
      
      // Fallback: find movie in current movies list
      const fallbackMovie = movies.find(m => m.id === movieId);
      if (fallbackMovie) {
        setSelectedMovie(fallbackMovie);
        const demoRecs = await generateDemoRecommendations();
        setRecommendations(demoRecs);
      }
    } finally {
      setLoading(false);
    }
  };

  const generateDemoRecommendations = async () => {
    const demoRecs = [
      {
        movie: {
          id: 99,
          title: "The Shawshank Redemption",
          director: "Frank Darabont",
          actors: ["Tim Robbins", "Morgan Freeman"],
          genres: ["Drama"],
          description: "Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.",
          rating: 9.3,
          image_url: await fetchMoviePoster("The Shawshank Redemption")
        },
        similarity_score: 0.85,
        reason: "Highly acclaimed drama"
      },
      {
        movie: {
          id: 100,
          title: "Forrest Gump",
          director: "Robert Zemeckis",
          actors: ["Tom Hanks", "Robin Wright"],
          genres: ["Drama", "Romance"],
          description: "The presidencies of Kennedy and Johnson through the eyes of an Alabama man with an IQ of 75.",
          rating: 8.8,
          image_url: await fetchMoviePoster("Forrest Gump")
        },
        similarity_score: 0.82,
        reason: "Similar storytelling style"
      }
    ];

    return demoRecs;
  };

  const searchMovies = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/search/movies?query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      } else {
        console.error('Search failed');
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error searching movies:', error);
      // Fallback: search in current movies
      const filtered = movies.filter(movie => 
        movie.title.toLowerCase().includes(query.toLowerCase()) ||
        movie.director.toLowerCase().includes(query.toLowerCase()) ||
        movie.actors.some(actor => actor.toLowerCase().includes(query.toLowerCase()))
      );
      setSearchResults(filtered);
    }
  };

  const analyzeSentiment = async () => {
    if (!reviewText.trim() || !selectedMovie) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/sentiment/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie_id: selectedMovie.id,
          review_text: reviewText
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setSentiment(data);
      } else {
        throw new Error('Sentiment analysis failed');
      }
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      // Fallback sentiment analysis
      const words = reviewText.toLowerCase();
      const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'best'];
      const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'worst', 'hate', 'disappointing'];
      
      let score = 0;
      positiveWords.forEach(word => {
        if (words.includes(word)) score += 1;
      });
      negativeWords.forEach(word => {
        if (words.includes(word)) score -= 1;
      });
      
      setSentiment({
        sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
        polarity: score * 0.3,
        subjectivity: 0.6
      });
    }
  };

  const MovieCard = ({ movie, onClick, size = 'large' }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [posterUrl, setPosterUrl] = useState('');
    const [triedFetch, setTriedFetch] = useState(false);

    useEffect(() => {
      setPosterUrl(movie.image_url);
      setImageLoaded(false);
      setImageError(false);
      setTriedFetch(false);
    }, [movie.id, movie.image_url]);

    useEffect(() => {
      let active = true;
      const checkAndFetchPoster = async () => {
        const isPlaceholder = !posterUrl || 
                              posterUrl.includes('placeholder') || 
                              posterUrl.includes('via.placeholder') ||
                              posterUrl.includes('placehold.co');
        if (isPlaceholder && !triedFetch && movie.title) {
          setTriedFetch(true);
          const fetchedUrl = await fetchMoviePoster(movie.title);
          if (active && fetchedUrl) {
            setPosterUrl(fetchedUrl);
          }
        }
      };
      checkAndFetchPoster();
      return () => {
        active = false;
      };
    }, [posterUrl, triedFetch, movie.title]);

    const handleImageError = async () => {
      if (!triedFetch && movie.title) {
        setTriedFetch(true);
        const fetchedUrl = await fetchMoviePoster(movie.title);
        if (fetchedUrl) {
          setPosterUrl(fetchedUrl);
          return;
        }
      }
      setImageError(true);
      setImageLoaded(true);
    };

    return (
      <div 
        className={`bg-gradient-to-br from-gray-900 to-black rounded-xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl border border-gray-800 group ${size === 'small' ? 'w-48' : 'w-64'}`}
        onClick={() => onClick(movie)}
      >
        <div className="relative overflow-hidden">
          <div className={`${size === 'small' ? 'h-64' : 'h-80'} bg-gray-800 flex items-center justify-center`}>
            {!imageLoaded && !imageError && (
              <div className="animate-pulse bg-gray-700 w-full h-full flex items-center justify-center">
                <Film className="text-gray-500" size={32} />
              </div>
            )}
            
            <img 
              src={posterUrl || movie.image_url} 
              alt={movie.title}
              className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-110 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={handleImageError}
            />
            
            {imageError && (
              <div className="absolute inset-0 bg-gray-800 flex flex-col items-center justify-center text-gray-400">
                <Film size={32} className="mb-2" />
                <span className="text-xs text-center px-2">{movie.title}</span>
              </div>
            )}
          </div>
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          {/* Rating Badge */}
          <div className="absolute top-3 right-3 bg-yellow-500 text-black px-2 py-1 rounded-full flex items-center gap-1 text-sm font-bold">
            <Star size={14} fill="currentColor" />
            {movie.rating}
          </div>

          {/* Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="bg-white/20 backdrop-blur-sm rounded-full p-4">
              <Play className="text-white" size={32} fill="currentColor" />
            </div>
          </div>
        </div>
        
        <div className="p-4">
          <h3 className={`text-white font-bold mb-2 line-clamp-2 ${size === 'small' ? 'text-sm' : 'text-lg'}`}>
            {movie.title}
          </h3>
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-1">
            <User size={14} />
            {movie.director}
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {movie.genres && movie.genres.slice(0, 2).map((genre) => (
              <span key={genre} className="bg-blue-600 text-white px-2 py-1 rounded-full text-xs">
                {genre}
              </span>
            ))}
          </div>
          <p className={`text-gray-300 line-clamp-2 ${size === 'small' ? 'text-xs' : 'text-sm'}`}>
            {movie.description}
          </p>
        </div>
      </div>
    );
  };

  const handleMovieClick = (movie) => {
    setSelectedMovie(movie);
    setViewMode('detail');
    setReviewText('');
    setSentiment(null);
    setRecommendations([]);
    fetchMovieDetails(movie.id);
  };

  const handleBackToHome = () => {
    setViewMode('home');
    setSelectedMovie(null);
    setRecommendations([]);
    setSearchQuery('');
    setSearchResults([]);
    setError(null);
  };

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    if (query.trim()) {
      setViewMode('search');
      searchMovies(query);
    } else {
      setViewMode('home');
      setSearchResults([]);
    }
  };

  if (loading && movies.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          Loading movies...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white">
      {/* Header */}
      <header className="bg-black/50 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {viewMode !== 'home' && (
                <button 
                  onClick={handleBackToHome}
                  className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <ArrowLeft size={24} />
                </button>
              )}
              <div className="flex items-center gap-2">
                <Film className="text-blue-500" size={32} />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                  CineRecommend
                </h1>
              </div>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Search movies, actors, directors..."
                value={searchQuery}
                onChange={handleSearch}
                className="bg-gray-800 border border-gray-700 rounded-lg py-2 pl-10 pr-4 w-80 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          
          {/* Status Bar */}
          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className={`flex items-center gap-1 ${apiConnected ? 'text-green-400' : 'text-yellow-400'}`}>
              <div className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
              {apiConnected ? `Connected • ${totalMovies} movies` : 'Demo Mode'}
            </span>
            {error && (
              <span className="text-red-400 text-xs">{error}</span>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {viewMode === 'home' && (
          <div>
            <div className="mb-8">
              <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Featured Movies
              </h2>
              <p className="text-gray-400">
                Discover amazing movies with real movie posters
                {totalMovies > 0 && ` • ${totalMovies} movies available`}
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {movies.map((movie) => (
                <MovieCard key={movie.id} movie={movie} onClick={handleMovieClick} />
              ))}
            </div>

            {/* Load More Button */}
            {hasMoreMovies && apiConnected && (
              <div className="text-center mt-8">
                <button
                  onClick={loadMoreMovies}
                  disabled={loadingMore}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-8 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 mx-auto"
                >
                  {loadingMore ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown size={20} />
                      Load More Movies
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {viewMode === 'search' && (
          <div>
            <div className="mb-8">
              <h2 className="text-3xl font-bold mb-2">
                Search Results for "{searchQuery}"
              </h2>
              <p className="text-gray-400">{searchResults.length} movies found</p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {searchResults.map((movie) => (
                <MovieCard key={movie.id} movie={movie} onClick={handleMovieClick} />
              ))}
            </div>
            
            {searchResults.length === 0 && searchQuery && (
              <div className="text-center py-12">
                <Film className="mx-auto mb-4 text-gray-500" size={48} />
                <p className="text-gray-400">No movies found for "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}

        {viewMode === 'detail' && selectedMovie && (
          <div className="max-w-6xl mx-auto">
            {/* Movie Hero Section */}
            <div className="bg-gradient-to-r from-gray-900 to-black rounded-2xl overflow-hidden mb-8 border border-gray-800">
              <div className="md:flex">
                <div className="md:w-1/3">
                  <img 
                    src={selectedMovie.image_url} 
                    alt={selectedMovie.title}
                    className="w-full h-96 md:h-full object-cover"
                    onError={(e) => {
                      e.target.src = `https://placehold.co/300x450/1a1a1a/ffffff?text=${encodeURIComponent(selectedMovie.title)}`;
                    }}
                  />
                </div>
                <div className="md:w-2/3 p-8">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                        {selectedMovie.title}
                      </h1>
                      <div className="flex items-center gap-4 text-gray-400 mb-4">
                        <span className="flex items-center gap-1">
                          <User size={16} />
                          {selectedMovie.director}
                        </span>
                        <span className="flex items-center gap-1">
                          <Star size={16} fill="currentColor" className="text-yellow-500" />
                          {selectedMovie.rating}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold mb-2">Cast</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedMovie.actors && selectedMovie.actors.map((actor) => (
                        <span key={actor} className="bg-gray-800 px-3 py-1 rounded-full text-sm">
                          {actor}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">Genres</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedMovie.genres && selectedMovie.genres.map((genre) => (
                        <span key={genre} className="bg-blue-600 px-3 py-1 rounded-full text-sm">
                          {genre}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <p className="text-gray-300 leading-relaxed">
                    {selectedMovie.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Review & Sentiment Analysis Section */}
            <div className="bg-gradient-to-r from-gray-900 to-black rounded-2xl p-8 mb-8 border border-gray-800">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Heart className="text-red-500" />
                Share Your Review
              </h2>
              
              <div className="space-y-4">
                <textarea
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="What did you think about this movie? Share your thoughts..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-4 h-32 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                
                <div className="flex items-center gap-4">
                  <button
                    onClick={analyzeSentiment}
                    disabled={!reviewText.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-semibold transition-colors"
                  >
                    Analyze Sentiment
                  </button>
                  
                  {sentiment && (
                    <div className="flex items-center gap-4">
                      <div className={`px-4 py-2 rounded-full text-sm font-semibold ${
                        sentiment.sentiment === 'positive' 
                          ? 'bg-green-600 text-white' 
                          : sentiment.sentiment === 'negative'
                          ? 'bg-red-600 text-white'
                          : 'bg-yellow-600 text-black'
                      }`}>
                        {sentiment.sentiment.charAt(0).toUpperCase() + sentiment.sentiment.slice(1)} Sentiment
                      </div>
                      <div className="text-gray-400 text-sm">
                        Confidence: {Math.abs(sentiment.polarity * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recommendations Section */}
            <div className="bg-gradient-to-r from-gray-900 to-black rounded-2xl p-8 border border-gray-800">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Info className="text-blue-500" />
                Recommended for You
              </h2>
              
              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-gray-400">Loading personalized recommendations...</p>
                </div>
              ) : recommendations.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {recommendations.map((rec, index) => (
                    <div key={index} className="group">
                      <MovieCard 
                        movie={rec.movie} 
                        onClick={handleMovieClick} 
                        size="small"
                      />
                      <div className="mt-2 p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-xs text-gray-400 mb-1">
                          Match: {(rec.similarity_score * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs text-gray-300">
                          {rec.reason}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Info className="mx-auto mb-4 text-gray-500" size={48} />
                  <p className="text-gray-400">No recommendations available for this movie.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-black/50 border-t border-gray-800 mt-16">
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Film className="text-blue-500" size={24} />
              <span className="text-xl font-bold">CineRecommend</span>
            </div>
            <p className="text-gray-400 mb-4">
              Discover your next favorite movie with AI-powered recommendations and real movie posters
            </p>
            <div className="flex justify-center gap-6 text-sm text-gray-500">
              <span>Powered by TMDB API</span>
              <span>•</span>
              <span>Machine Learning</span>
              <span>•</span>
              <span>Sentiment Analysis</span>
            </div>
          </div>
        </div>
      </footer>

      {/* CineBot Chatbot UI */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {chatOpen ? (
          <div className="w-96 h-[500px] bg-gray-900/95 backdrop-blur-xl border border-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden mb-4 transition-all duration-300 transform scale-100 origin-bottom-right">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="text-white" size={24} />
                <div>
                  <h3 className="font-bold text-white text-sm">CineBot AI</h3>
                  <span className="text-xs text-blue-200">Movie Recommendation Assistant</span>
                </div>
              </div>
              <button 
                onClick={() => setChatOpen(false)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-custom">
              {chatHistory.map((msg, index) => (
                <div 
                  key={index} 
                  className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-800'
                  }`}>
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-tr-none' 
                      : 'bg-gray-800 text-gray-200 rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="bg-gray-800 text-gray-200 rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={sendChatMessage} className="p-3 bg-black/40 border-t border-gray-800 flex gap-2">
              <input
                type="text"
                placeholder="Ask CineBot..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button 
                type="submit"
                disabled={!chatMessage.trim() || chatLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white p-2 rounded-xl transition-colors"
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        ) : null}

        {/* Floating Bubble Button */}
        <button
          onClick={() => setChatOpen(true)}
          className={`bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center ${
            chatOpen ? 'opacity-0 pointer-events-none scale-0' : 'opacity-100 scale-100'
          }`}
        >
          <MessageSquare size={28} />
        </button>
      </div>
    </div>
  );
};

export default App;