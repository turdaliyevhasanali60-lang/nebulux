import requests

def create_user():
    res = requests.post('http://127.0.0.1:8000/api/auth/register/', json={'email': 'freetest@example.com', 'password': 'password123', 'name': 'Free Test'})
    return res.json()

if __name__ == '__main__':
    print(create_user())
