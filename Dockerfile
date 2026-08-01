FROM nginx:alpine

COPY web/ /usr/share/nginx/html/

EXPOSE 3000

RUN sed -i 's/listen\s*80;/listen 3000;/' /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
