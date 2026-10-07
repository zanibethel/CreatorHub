-- Raise CreatorHub File Transfer bucket limit to 5 GB.
update storage.buckets
set file_size_limit = 5368709120
where id = 'creatorhub-uploads';
