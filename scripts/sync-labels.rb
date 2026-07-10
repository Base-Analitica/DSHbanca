#!/usr/bin/env ruby
# frozen_string_literal: true

require "cgi"
require "json"
require "net/http"
require "uri"
require "yaml"

CONFIG_PATH = ARGV.fetch(0, ".github/labels.yml")
REPOSITORY = ENV.fetch("GITHUB_REPOSITORY")
TOKEN = ENV.fetch("GITHUB_TOKEN")
API_ROOT = ENV.fetch("GITHUB_API_URL", "https://api.github.com")

abort("Label config not found: #{CONFIG_PATH}") unless File.file?(CONFIG_PATH)

config = YAML.safe_load(File.read(CONFIG_PATH), permitted_classes: [], aliases: false)
labels = config.fetch("labels")
abort("labels must be a non-empty array") unless labels.is_a?(Array) && !labels.empty?

names = labels.map { |label| label.fetch("name") }
duplicates = names.group_by(&:itself).select { |_name, values| values.length > 1 }.keys
abort("Duplicate label names: #{duplicates.join(', ')}") unless duplicates.empty?

HTTP_SUCCESS = (200..299)

def request(method, path, body = nil)
  uri = URI.join(API_ROOT.end_with?("/") ? API_ROOT : "#{API_ROOT}/", path.sub(%r{\A/}, ""))
  klass = {
    get: Net::HTTP::Get,
    post: Net::HTTP::Post,
    patch: Net::HTTP::Patch
  }.fetch(method)

  req = klass.new(uri)
  req["Accept"] = "application/vnd.github+json"
  req["Authorization"] = "Bearer #{TOKEN}"
  req["X-GitHub-Api-Version"] = "2022-11-28"
  req["User-Agent"] = "openbanca-label-sync"
  if body
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(body)
  end

  Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|
    http.request(req)
  end
end

labels.each do |label|
  name = label.fetch("name").to_s.strip
  color = label.fetch("color").to_s.delete_prefix("#").downcase
  description = label.fetch("description").to_s.strip

  abort("Invalid empty label name") if name.empty?
  abort("Invalid color for #{name}: #{color}") unless color.match?(/\A[0-9a-f]{6}\z/)
  abort("Description is required for #{name}") if description.empty?
  abort("Description too long for #{name}") if description.length > 100

  encoded_name = CGI.escape(name).gsub("+", "%20")
  payload = { new_name: name, color: color, description: description }
  response = request(:patch, "/repos/#{REPOSITORY}/labels/#{encoded_name}", payload)

  if response.code.to_i == 404
    response = request(
      :post,
      "/repos/#{REPOSITORY}/labels",
      { name: name, color: color, description: description }
    )
    action = "created"
  else
    action = "updated"
  end

  unless HTTP_SUCCESS.cover?(response.code.to_i)
    warn response.body
    abort("Failed to sync #{name}: HTTP #{response.code}")
  end

  puts "#{action}: #{name}"
end

puts "Synchronized #{labels.length} labels for #{REPOSITORY}."
