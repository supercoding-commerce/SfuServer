# STEP 1
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build


# STEP 2
FROM node:20

WORKDIR /app

COPY --from=builder /app ./
#10 : 주의. 반드시 쌍따옴표!
CMD [ "node", "dist/main" ]