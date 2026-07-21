import os
import shutil
import tempfile
from pathlib import Path
from git import Repo
import urllib.parse

class RepoCloner:
    def __init__(self, storage_dir: str = None):
        if storage_dir is None:
            # Save cloned repos in the workspace backend data directory
            self.storage_dir = Path(__file__).parent.parent.parent / "data" / "cloned_repos"
        else:
            self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def clone_or_locate(self, repo_source: str) -> Path:
        """
        Accepts a GitHub URL or a local folder path.
        Clones remote URLs or returns the absolute path if it is a local directory.
        """
        # Check if it's a local directory
        if os.path.exists(repo_source) and os.path.isdir(repo_source):
            return Path(repo_source).resolve()
        
        # Assume it's a git URL
        try:
            # Parse URL to get repo name
            parsed = urllib.parse.urlparse(repo_source)
            path_parts = [p for p in parsed.path.split("/") if p]
            if not path_parts:
                raise ValueError("Invalid Git URL path")
            
            repo_name = path_parts[-1]
            if repo_name.endswith(".git"):
                repo_name = repo_name[:-4]
            
            target_path = self.storage_dir / repo_name
            
            # If repo already exists, delete it or pull (we delete & re-clone for simplicity)
            if target_path.exists():
                shutil.rmtree(target_path)
                
            print(f"Cloning {repo_source} into {target_path}...")
            Repo.clone_from(repo_source, target_path)
            return target_path
            
        except Exception as e:
            raise ValueError(f"Failed to clone repository: {str(e)}")

    def detect_languages(self, repo_path: Path) -> dict:
        """
        Scans files in the directory to detect the main languages.
        """
        extension_counts = {}
        total_files = 0
        
        ext_to_lang = {
            ".py": "Python",
            ".js": "JavaScript",
            ".ts": "TypeScript",
            ".tsx": "TypeScript (React)",
            ".jsx": "JavaScript (React)",
            ".go": "Go",
            ".rs": "Rust",
            ".java": "Java",
            ".kt": "Kotlin",
            ".cpp": "C++",
            ".c": "C",
            ".cs": "C#",
            ".rb": "Ruby",
            ".php": "PHP",
            ".swift": "Swift",
        }
        
        for root, dirs, files in os.walk(repo_path):
            # Ignore common build/env directories
            dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "venv", "__pycache__", "build", "dist", "target"}]
            for file in files:
                ext = Path(file).suffix.lower()
                if ext in ext_to_lang:
                    lang = ext_to_lang[ext]
                    extension_counts[lang] = extension_counts.get(lang, 0) + 1
                total_files += 1
                
        # Calculate percentages
        languages = {}
        for lang, count in extension_counts.items():
            languages[lang] = round((count / max(total_files, 1)) * 100, 2)
            
        return {
            "main_languages": sorted(languages.items(), key=lambda x: x[1], reverse=True),
            "total_files": total_files
        }
