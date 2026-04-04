FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash jq git \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global user.email "test@test.com" \
    && git config --global user.name "Test User"

WORKDIR /app
COPY . /app/

# Unpack corpus data and reconstruct repos
RUN mkdir -p /tmp/corpus-raw /home/testuser/Projects \
    && tar -xzf tests/docker-e2e/corpus-data.tar.gz -C /tmp/corpus-raw \
    && for repo_dir in /tmp/corpus-raw/*/; do \
         name="$(basename "$repo_dir")"; \
         proj_name="$(echo "$name" | sed 's/.*__//')"; \
         bash tests/docker-e2e/reconstruct-repo.sh "$repo_dir" "/home/testuser/Projects/${proj_name}"; \
       done \
    && rm -rf /tmp/corpus-raw \
    && echo "Reconstructed $(ls /home/testuser/Projects | wc -l) repos"

CMD ["bash", "tests/docker-e2e/run-tests.sh"]
