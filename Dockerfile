FROM node:18.15

WORKDIR /usr/src/csgofloat

COPY package*.json ./
RUN npm install

COPY . .

# Normalize Windows CRLF -> LF and mark start script executable
RUN sed -i 's/\r$//' docker_start.sh && chmod +x docker_start.sh

EXPOSE 80
EXPOSE 443
VOLUME /config

CMD ["/bin/bash", "/usr/src/csgofloat/docker_start.sh"]
